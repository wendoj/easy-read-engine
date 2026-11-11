/**
 * Text from a photo of a letter, through the vision chain (R1.3, R1.4).
 * Prompt: `prompts/vision.md`. The model first decides printed or
 * handwritten, then readable or not, then copies the text.
 */
import { z } from "zod";
import type { ModelClient } from "@/src/llm/client";
import { type PromptTemplate, renderTemplate } from "@/src/llm/prompts";
import { type StructuredOptions, type ToolDefinition, callStructured } from "@/src/llm/structured";
import { IMAGE_MIME, type ImageKind } from "./file-type";

/** A 1,500-word letter is about 2,000 tokens. The rest is headroom. */
export const VISION_MAX_TOKENS = 4000;

export const SUBMIT_PAGE_TOOL: ToolDefinition = {
  name: "submit_page",
  description: "Submit whether the letter is handwritten, whether it is readable, and its text.",
  parameters: {
    type: "object",
    properties: {
      handwritten: { type: "boolean", description: "True if the body of the letter is written by hand." },
      readable: { type: "boolean", description: "False if most of the text can't be read." },
      text: { type: "string", description: "All the printed text, copied exactly. Empty if handwritten or unreadable." },
    },
    required: ["handwritten", "readable", "text"],
  },
};

export const visionSchema = z.object({
  handwritten: z.boolean(),
  readable: z.boolean(),
  text: z.string(),
});

export type VisionPage = z.infer<typeof visionSchema>;

export interface VisionResult {
  page: VisionPage;
  provider: string;
  model: string;
  requests: number;
}

export function imageDataUrl(bytes: Uint8Array, kind: ImageKind): string {
  return `data:${IMAGE_MIME[kind]};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** The user message: the prompt's user text, then the image. */
export function buildVisionUserContent(prompt: PromptTemplate, bytes: Uint8Array, kind: ImageKind): unknown[] {
  return [
    { type: "text", text: renderTemplate(prompt.user, {}) },
    { type: "image_url", image_url: { url: imageDataUrl(bytes, kind) } },
  ];
}

export async function readImage(
  client: ModelClient,
  prompt: PromptTemplate,
  bytes: Uint8Array,
  kind: ImageKind,
  options: StructuredOptions = {},
): Promise<VisionResult> {
  const result = await callStructured(
    client,
    {
      task: "vision",
      role: "vision",
      system: prompt.system,
      user: buildVisionUserContent(prompt, bytes, kind),
      tool: SUBMIT_PAGE_TOOL,
      schema: visionSchema,
      maxTokens: VISION_MAX_TOKENS,
      temperature: 0,
    },
    options,
  );
  return { page: result.data, provider: result.provider, model: result.model, requests: result.requests };
}
