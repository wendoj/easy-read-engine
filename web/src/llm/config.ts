import { z } from "zod";

/** Default AWS Region for Bedrock. London keeps UK letter text in the UK. */
export const DEFAULT_AWS_REGION = "eu-west-2";

/**
 * Providers that offer an OpenAI-compatible chat completions API.
 *
 * - `bedrock`: Amazon Bedrock's `bedrock-runtime` endpoint, called in-Region
 *   (no cross-Region inference profile), with a Bedrock API key.
 * - `groq`: fallback.
 */
export const PROVIDERS = {
  bedrock: {
    baseUrl: (region: string) => `https://bedrock-runtime.${region}.amazonaws.com/openai/v1`,
    keyEnv: "AWS_BEARER_TOKEN_BEDROCK",
  },
  groq: {
    baseUrl: () => "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
  },
} as const;

export type Provider = keyof typeof PROVIDERS;
export type Role = "rewrite" | "judge" | "vision";

export const ROLE_ENV: Record<Role, string> = {
  rewrite: "MODEL_REWRITE",
  judge: "MODEL_JUDGE",
  vision: "MODEL_VISION",
};

export type AppEnv = "development" | "production";

export interface ChainEntry {
  provider: Provider;
  model: string;
}

export interface ModelConfig {
  appEnv: AppEnv;
  chains: Record<Role, ChainEntry[]>;
  /** API key per provider, read from env. Missing keys are left out. */
  keys: Partial<Record<Provider, string>>;
  /** Chat completions base URL per provider. Defaults to `providerBaseUrls()` (Bedrock in eu-west-2). */
  baseUrls?: Record<Provider, string>;
}

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

const providerSchema = z.enum(["bedrock", "groq"]);
const appEnvSchema = z.enum(["development", "production"]);
/** AWS Region names such as `eu-west-2`. Checked so env text can't change the host. */
const regionSchema = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/);

/**
 * Parse one `provider:model` entry. Only the first colon splits, because
 * model IDs can contain colons (for example `openai.gpt-oss-120b-1:0`).
 */
export function parseEntry(raw: string): ChainEntry {
  const text = raw.trim();
  const colon = text.indexOf(":");
  if (colon <= 0 || colon === text.length - 1) {
    throw new ModelConfigError(`Model entry must be "provider:model": "${text}"`);
  }
  const provider = providerSchema.safeParse(text.slice(0, colon));
  if (!provider.success) {
    throw new ModelConfigError(
      `Unknown model provider in entry "${text}". Use one of: ${providerSchema.options.join(", ")}`,
    );
  }
  return { provider: provider.data, model: text.slice(colon + 1) };
}

/** Parse a comma-separated, ordered chain. Empty items are ignored. */
export function parseChain(raw: string | undefined): ChainEntry[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseEntry);
}

/** Base URL for each provider. Throws if the Region isn't a valid AWS Region name. */
export function providerBaseUrls(region: string = DEFAULT_AWS_REGION): Record<Provider, string> {
  const parsed = regionSchema.safeParse(region);
  if (!parsed.success) {
    throw new ModelConfigError(`AWS_REGION must be an AWS Region name such as "${DEFAULT_AWS_REGION}"`);
  }
  return {
    bedrock: PROVIDERS.bedrock.baseUrl(parsed.data),
    groq: PROVIDERS.groq.baseUrl(),
  };
}

/** Read and validate the model configuration from env. Throws on bad config. */
export function loadModelConfig(env: Record<string, string | undefined> = process.env): ModelConfig {
  const appEnv = appEnvSchema.safeParse(env.APP_ENV ?? "development");
  if (!appEnv.success) {
    throw new ModelConfigError(`APP_ENV must be "development" or "production"`);
  }
  const chains = {
    rewrite: parseChain(env[ROLE_ENV.rewrite]),
    judge: parseChain(env[ROLE_ENV.judge]),
    vision: parseChain(env[ROLE_ENV.vision]),
  };
  const keys: Partial<Record<Provider, string>> = {};
  for (const provider of Object.keys(PROVIDERS) as Provider[]) {
    const key = env[PROVIDERS[provider].keyEnv];
    if (key) keys[provider] = key;
  }
  const baseUrls = providerBaseUrls(env.AWS_REGION || DEFAULT_AWS_REGION);
  return { appEnv: appEnv.data, chains, keys, baseUrls };
}
