/**
 * Ask for JSON through a forced tool call, validate it with zod, and retry once.
 *
 * - The reply is read from the tool call, or from JSON in the content if the
 *   model answered there instead.
 * - A 400 on the tool request (gpt-oss has called a tool name that was not
 *   offered, `tool_use_failed`) makes the retry drop the tools and ask for
 *   plain JSON in the content.
 * - An invalid reply makes the retry name the wrong fields (paths only).
 * - A second failure throws `ModelOutputError` (502). It does not use up one
 *   of the pipeline's 3 tries.
 *
 * Never log prompts, letter text, model output or key-fact values.
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
  /** 1, or 2 after a retry. */
  requests: number;
  via: "tool" | "content";
}

export type StructuredOutcome = "valid" | "invalid" | "tool_rejected";

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

/** `issues` holds field paths and zod issue codes only, never values from the model output. */
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

/** Strips `<think>` blocks and code fences. */
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
 * Tool calls with the expected name are tried first, then any other tool
 * call (the shape decides), then JSON in the content.
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

function buildRequest(spec: StructuredSpec<unknown>, messages: ChatMessage[], mode: RequestMode): ChatRequest {
  return {
    messages,
    ...(mode === "tools"
      ? {
          tools: [{ type: "function", function: spec.tool }],
          tool_choice: { type: "function", function: { name: spec.tool.name } },
        }
      : {}),
    maxTokens: spec.maxTokens,
    ...(spec.temperature !== undefined ? { temperature: spec.temperature } : {}),
  };
}

type SendOutcome<T> = { ok: true; result: StructuredResult<T> } | { ok: false; rejected: boolean; issues: string[] };

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

  /** One request. Errors other than a tool rejection propagate. */
  const send = async (attempt: number, mode: RequestMode, messages: ChatMessage[]): Promise<SendOutcome<T>> => {
    const start = now();
    const emit = (outcome: StructuredOutcome, r?: ChatResult) =>
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
    let r: ChatResult;
    try {
      r = await client.chat(spec.role, buildRequest(spec as StructuredSpec<unknown>, messages, mode));
    } catch (err) {
      if (!isToolRejection(err)) throw err;
      emit("tool_rejected");
      return { ok: false, rejected: true, issues: ["tool request rejected"] };
    }
    const parsed = parseStructured(r.message, spec.tool.name, spec.schema);
    emit(parsed.ok ? "valid" : "invalid", r);
    if (!parsed.ok) return { ok: false, rejected: false, issues: parsed.issues };
    return {
      ok: true,
      result: { data: parsed.data, provider: r.provider, model: r.model, requests: attempt, via: parsed.via },
    };
  };

  const first = await send(1, "tools", base);
  if (first.ok) return first.result;

  const mode: RequestMode = first.rejected ? "content" : "tools";
  const note = first.rejected
    ? "Do not call any tool. Reply with only one JSON object and nothing else. " +
      `It must match this JSON schema: ${JSON.stringify(spec.tool.parameters)}`
    : `Your last answer did not match the \`${spec.tool.name}\` format. ` +
      `These fields were wrong: ${first.issues.join("; ")}. ` +
      `Call \`${spec.tool.name}\` again with every field filled in.`;
  const second = await send(2, mode, [...base, { role: "user", content: note }]);
  if (second.ok) return second.result;
  throw new ModelOutputError(spec.task, 2, second.rejected ? [...first.issues, ...second.issues] : second.issues);
}
