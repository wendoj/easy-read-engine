/**
 * Structured model calls: ask for JSON through a tool definition, validate it
 * with zod, and retry once (design "Model client" and "Error Handling").
 *
 * - Request 1 forces the tool. The reply is read from the tool call, or from
 *   JSON in the message content if the model answered there instead.
 * - If the provider rejects the tool request with a 400 (the day 1 spike saw
 *   gpt-oss call a tool name that was not offered, `tool_use_failed`), request 2
 *   drops the tools and asks for plain JSON in the content.
 * - If the reply is not valid, request 2 asks again, naming the fields that
 *   were wrong (paths only).
 * - If request 2 is also not valid, `ModelOutputError` is thrown. The route
 *   maps it to 502. This does not use up one of the pipeline's 3 tries.
 *
 * Logging: only the task, role, provider, model, request number, mode,
 * outcome and time. Never prompts, letter text, model output or key-fact values.
 */
import type { z } from "zod";
import type { Role } from "./config";
import { type ChatMessage, type ChatRequest, type ChatResult, type ModelClient, ProviderRequestError } from "./client";

export type StructuredTask = "rewrite" | "regenerate" | "judge" | "vision";

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema for the tool arguments. */
  parameters: Record<string, unknown>;
}

export interface StructuredSpec<T> {
  task: StructuredTask;
  role: Role;
  system: string;
  /** Plain text, or OpenAI content parts (text and `image_url`) for vision. */
  user: string | unknown[];
  tool: ToolDefinition;
  schema: z.ZodType<T>;
  maxTokens: number;
  temperature?: number;
}

export type RequestMode = "tools" | "content";

export interface StructuredResult<T> {
  data: T;
  /** Provider and model that gave the valid answer. */
  provider: ChatResult["provider"];
  model: string;
  /** Model requests made: 1, or 2 after a retry. */
  requests: number;
  via: "tool" | "content";
}

export type StructuredOutcome = "valid" | "invalid" | "tool_rejected";

/** Log event. Holds no prompt, letter text, model output or key-fact values. */
export interface StructuredLogEvent {
  msg: "llm_task";
  task: StructuredTask;
  role: Role;
  provider?: string;
  model?: string;
  attempt: number;
  mode: RequestMode;
  outcome: StructuredOutcome;
  ms: number;
}

export type StructuredLogger = (event: StructuredLogEvent) => void;

const defaultLogger: StructuredLogger = (event) => {
  console.info(JSON.stringify(event));
};

export interface StructuredOptions {
  logger?: StructuredLogger;
  now?: () => number;
}

/**
 * The model gave no valid answer after the one retry. `issues` holds field
 * paths and zod issue codes only, never values from the model output.
 */
export class ModelOutputError extends Error {
  constructor(
    readonly task: StructuredTask,
    readonly requests: number,
    readonly issues: string[],
  ) {
    super(`Model output for "${task}" was not valid after ${requests} requests`);
    this.name = "ModelOutputError";
  }
}

/** Read a JSON object from message content: strips `<think>` blocks and code fences. */
export function parseJsonLoose(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : cleaned;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new SyntaxError("no JSON object");
  return JSON.parse(body.slice(start, end + 1));
}

interface ToolCallLike {
  function?: { name?: unknown; arguments?: unknown };
}

type ParseOutcome<T> = { ok: true; data: T; via: "tool" | "content" } | { ok: false; issues: string[] };

/** Paths and codes only. Custom issues carry our own fixed messages, which hold no values. */
function issuesOf(error: z.ZodError): string[] {
  return error.issues
    .slice(0, 10)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.code === "custom" ? i.message : i.code}`);
}

/**
 * Pull a valid answer from a reply. Tool calls with the expected name are
 * tried first, then any other tool call (the shape decides), then JSON in
 * the content.
 */
export function parseStructured<T>(
  message: ChatResult["message"],
  toolName: string,
  schema: z.ZodType<T>,
): ParseOutcome<T> {
  const calls = ((message.tool_calls ?? []) as ToolCallLike[]).filter((c) => c && typeof c === "object");
  const ordered = [
    ...calls.filter((c) => c.function?.name === toolName),
    ...calls.filter((c) => c.function?.name !== toolName),
  ];
  const issues: string[] = [];
  const candidates: { value: () => unknown; via: "tool" | "content" }[] = ordered.map((c) => ({
    via: "tool",
    value: () => {
      const a = c.function?.arguments;
      return typeof a === "string" ? JSON.parse(a) : a;
    },
  }));
  if (typeof message.content === "string" && message.content.trim()) {
    const content = message.content;
    candidates.push({ via: "content", value: () => parseJsonLoose(content) });
  }
  for (const candidate of candidates) {
    let value: unknown;
    try {
      value = candidate.value();
    } catch {
      issues.push(`${candidate.via}: invalid JSON`);
      continue;
    }
    const parsed = schema.safeParse(value);
    if (parsed.success) return { ok: true, data: parsed.data, via: candidate.via };
    issues.push(...issuesOf(parsed.error).map((i) => `${candidate.via}: ${i}`));
  }
  if (candidates.length === 0) issues.push("no tool call and no content");
  return { ok: false, issues };
}

function isToolRejection(err: unknown): boolean {
  return err instanceof ProviderRequestError && err.attempt.outcome === "client_error" && err.attempt.status === 400;
}

function toolRequest(spec: StructuredSpec<unknown>, messages: ChatMessage[]): ChatRequest {
  return {
    messages,
    tools: [{ type: "function", function: spec.tool }],
    tool_choice: { type: "function", function: { name: spec.tool.name } },
    maxTokens: spec.maxTokens,
    ...(spec.temperature !== undefined ? { temperature: spec.temperature } : {}),
  };
}

function contentRequest(spec: StructuredSpec<unknown>, messages: ChatMessage[]): ChatRequest {
  return {
    messages,
    maxTokens: spec.maxTokens,
    ...(spec.temperature !== undefined ? { temperature: spec.temperature } : {}),
  };
}

export async function callStructured<T>(
  client: ModelClient,
  spec: StructuredSpec<T>,
  options: StructuredOptions = {},
): Promise<StructuredResult<T>> {
  const log = options.logger ?? defaultLogger;
  const now = options.now ?? (() => performance.now());
  const base: ChatMessage[] = [
    { role: "system", content: spec.system },
    { role: "user", content: spec.user },
  ];
  const s = spec as StructuredSpec<unknown>;

  const emit = (attempt: number, mode: RequestMode, outcome: StructuredOutcome, start: number, r?: ChatResult) =>
    log({
      msg: "llm_task",
      task: spec.task,
      role: spec.role,
      ...(r ? { provider: r.provider, model: r.model } : {}),
      attempt,
      mode,
      outcome,
      ms: Math.round(now() - start),
    });

  // Request 1: tool call.
  let retry: { mode: RequestMode; note: string };
  let lastIssues: string[] = [];
  const start1 = now();
  try {
    const r1 = await client.chat(spec.role, toolRequest(s, base));
    const p1 = parseStructured(r1.message, spec.tool.name, spec.schema);
    if (p1.ok) {
      emit(1, "tools", "valid", start1, r1);
      return { data: p1.data, provider: r1.provider, model: r1.model, requests: 1, via: p1.via };
    }
    emit(1, "tools", "invalid", start1, r1);
    lastIssues = p1.issues;
    retry = {
      mode: "tools",
      note:
        `Your last answer did not match the \`${spec.tool.name}\` format. ` +
        `These fields were wrong: ${p1.issues.join("; ")}. ` +
        `Call \`${spec.tool.name}\` again with every field filled in.`,
    };
  } catch (err) {
    if (!isToolRejection(err)) throw err;
    emit(1, "tools", "tool_rejected", start1);
    lastIssues = ["tool request rejected"];
    retry = {
      mode: "content",
      note:
        "Do not call any tool. Reply with only one JSON object and nothing else. " +
        `It must match this JSON schema: ${JSON.stringify(spec.tool.parameters)}`,
    };
  }

  // Request 2: the one retry.
  const messages: ChatMessage[] = [...base, { role: "user", content: retry.note }];
  const start2 = now();
  let r2: ChatResult;
  try {
    r2 = await client.chat(spec.role, retry.mode === "tools" ? toolRequest(s, messages) : contentRequest(s, messages));
  } catch (err) {
    if (!isToolRejection(err)) throw err;
    emit(2, retry.mode, "tool_rejected", start2);
    throw new ModelOutputError(spec.task, 2, [...lastIssues, "tool request rejected"]);
  }
  const p2 = parseStructured(r2.message, spec.tool.name, spec.schema);
  if (p2.ok) {
    emit(2, retry.mode, "valid", start2, r2);
    return { data: p2.data, provider: r2.provider, model: r2.model, requests: 2, via: p2.via };
  }
  emit(2, retry.mode, "invalid", start2, r2);
  throw new ModelOutputError(spec.task, 2, p2.issues);
}
