import { z } from "zod";

/** London keeps UK letter text in the UK. */
export const DEFAULT_AWS_REGION = "eu-west-2";

/** Bedrock is called in-Region, never through a cross-Region inference profile. Groq is the fallback. */
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
  /** Missing keys are left out. */
  keys: Partial<Record<Provider, string>>;
  /** Defaults to `providerBaseUrls()`. */
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
// Checked so env text can't change the host.
const regionSchema = z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/);

/** Only the first colon splits, because model IDs can contain colons (`openai.gpt-oss-120b-1:0`). */
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

export function parseChain(raw: string | undefined): ChainEntry[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseEntry);
}

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
