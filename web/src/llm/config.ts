import { z } from "zod";

/** Providers that offer an OpenAI-compatible chat completions API. */
export const PROVIDERS = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
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
}

export class ModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelConfigError";
  }
}

const providerSchema = z.enum(["groq", "openrouter", "gemini"]);
const appEnvSchema = z.enum(["development", "production"]);

/**
 * Parse one `provider:model` entry. Only the first colon splits, because
 * model IDs can contain colons (for example `nvidia/...:free`).
 */
export function parseEntry(raw: string): ChainEntry {
  const text = raw.trim();
  const colon = text.indexOf(":");
  if (colon <= 0 || colon === text.length - 1) {
    throw new ModelConfigError(`Model entry must be "provider:model": "${text}"`);
  }
  const provider = providerSchema.safeParse(text.slice(0, colon));
  if (!provider.success) {
    throw new ModelConfigError(`Unknown model provider in entry "${text}"`);
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

/**
 * Start-up check. Gemini's free tier must not be used in an app offered to
 * UK users, so production must never list a `gemini:` entry.
 */
export function assertProductionSafe(config: Pick<ModelConfig, "appEnv" | "chains">): void {
  if (config.appEnv !== "production") return;
  for (const role of Object.keys(config.chains) as Role[]) {
    if (config.chains[role].some((e) => e.provider === "gemini")) {
      throw new ModelConfigError(
        `${ROLE_ENV[role]} lists a gemini: entry, which is not allowed when APP_ENV=production`,
      );
    }
  }
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
  const config: ModelConfig = { appEnv: appEnv.data, chains, keys };
  assertProductionSafe(config);
  return config;
}
