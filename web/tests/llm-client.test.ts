import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  type ChainEntry,
  type ModelConfig,
  type ModelLogEvent,
  type Provider,
  type Transport,
  type TransportRequest,
  type TransportResponse,
  ModelConfigError,
  PROVIDERS,
  ProviderChainError,
  ProviderRequestError,
  buildBody,
  createModelClient,
  loadModelConfig,
  parseChain,
  parseRetryAfter,
} from "@/src/llm";

const KEYS = { groq: "test-groq-key", openrouter: "test-or-key", gemini: "test-gemini-key" };
const REQUEST = { messages: [{ role: "user" as const, content: "PROMPT TEXT" }] };

function okResponse(content = "MODEL OUTPUT"): TransportResponse {
  return {
    status: 200,
    headers: {},
    json: { choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] },
  };
}

function providerOf(url: string): Provider {
  const match = (Object.keys(PROVIDERS) as Provider[]).find((p) => url.startsWith(PROVIDERS[p].baseUrl));
  if (!match) throw new Error(`unexpected url ${url}`);
  return match;
}

function config(chain: ChainEntry[], appEnv: "development" | "production" = "development"): ModelConfig {
  return { appEnv, chains: { rewrite: chain, judge: chain, vision: chain }, keys: { ...KEYS } };
}

type Behaviour =
  | { kind: "ok" }
  | { kind: "status"; status: number }
  | { kind: "timeout" }
  | { kind: "network" };

const failure: fc.Arbitrary<Behaviour> = fc.oneof(
  fc.constant<Behaviour>({ kind: "status", status: 429 }),
  fc.integer({ min: 500, max: 599 }).map<Behaviour>((status) => ({ kind: "status", status })),
  fc.constant<Behaviour>({ kind: "timeout" }),
  fc.constant<Behaviour>({ kind: "network" }),
);
const behaviour: fc.Arbitrary<Behaviour> = fc.oneof(fc.constant<Behaviour>({ kind: "ok" }), failure);

/** Fake transport: answers by model ID and records every call in order. */
function fakeTransport(byModel: Map<string, Behaviour>) {
  const calls: TransportRequest[] = [];
  const transport: Transport = async (req) => {
    calls.push(req);
    const b = byModel.get((req.body as { model: string }).model);
    if (!b) throw new Error("unknown model");
    switch (b.kind) {
      case "ok":
        return okResponse();
      case "status":
        return { status: b.status, headers: {}, json: null };
      case "timeout": {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      }
      case "network":
        throw new TypeError("fetch failed");
    }
  };
  return { transport, calls };
}

const noLog = () => {};

describe("provider chain properties", () => {
  /**
   * For any pattern of provider failures, entries are tried in order and
   * nothing is called after a success.
   * **Validates: Requirements 7.5 (supports); design "Model provider"**
   */
  it("tries entries in order and stops at the first success", async () => {
    const providers: fc.Arbitrary<Provider> = fc.constantFrom("groq", "openrouter", "gemini");
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(providers, behaviour), { minLength: 1, maxLength: 6 }),
        fc.constantFrom("rewrite", "judge", "vision" as const),
        async (spec, role) => {
          const chain = spec.map(([provider], i) => ({ provider, model: `m${i}` }));
          const byModel = new Map(spec.map(([, b], i) => [`m${i}`, b]));
          const { transport, calls } = fakeTransport(byModel);
          const client = createModelClient({ config: config(chain), transport, logger: noLog });

          const firstOk = spec.findIndex(([, b]) => b.kind === "ok");
          const expectedCalls = firstOk === -1 ? chain : chain.slice(0, firstOk + 1);

          if (firstOk === -1) {
            await expect(client.chat(role, REQUEST)).rejects.toBeInstanceOf(ProviderChainError);
          } else {
            const result = await client.chat(role, REQUEST);
            expect(result.provider).toBe(chain[firstOk].provider);
            expect(result.model).toBe(chain[firstOk].model);
            expect(result.attempts.map((a) => a.model)).toEqual(expectedCalls.map((e) => e.model));
          }
          expect(calls.map((c) => (c.body as { model: string }).model)).toEqual(
            expectedCalls.map((e) => e.model),
          );
          expect(calls.map((c) => providerOf(c.url))).toEqual(expectedCalls.map((e) => e.provider));
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * No `gemini:` entry is ever called in production mode, for any chain and
   * any pattern of failures. A chain with a gemini entry fails at start-up.
   * **Validates: Requirements 7.5 (supports); design "Model provider"**
   */
  it("never calls a gemini entry in production", async () => {
    const providers: fc.Arbitrary<Provider> = fc.constantFrom("groq", "openrouter", "gemini");
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(providers, behaviour), { minLength: 1, maxLength: 6 }),
        async (spec) => {
          const chain = spec.map(([provider], i) => ({ provider, model: `m${i}` }));
          const byModel = new Map(spec.map(([, b], i) => [`m${i}`, b]));
          const { transport, calls } = fakeTransport(byModel);
          const hasGemini = chain.some((e) => e.provider === "gemini");
          const env = {
            APP_ENV: "production",
            MODEL_REWRITE: chain.map((e) => `${e.provider}:${e.model}`).join(","),
          };

          if (hasGemini) {
            expect(() => loadModelConfig(env)).toThrow(ModelConfigError);
            expect(() =>
              createModelClient({ config: config(chain, "production"), transport, logger: noLog }),
            ).toThrow(ModelConfigError);
          } else {
            const client = createModelClient({ config: config(chain, "production"), transport, logger: noLog });
            await client.chat("rewrite", REQUEST).catch(() => undefined);
          }
          expect(calls.some((c) => providerOf(c.url) === "gemini")).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("config", () => {
  it("parses provider:model entries, keeping colons in the model ID", () => {
    expect(parseChain("groq:openai/gpt-oss-120b, openrouter:nvidia/nemotron-3-ultra-550b-a55b:free")).toEqual([
      { provider: "groq", model: "openai/gpt-oss-120b" },
      { provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" },
    ]);
  });

  it("rejects unknown providers and malformed entries", () => {
    expect(() => parseChain("openai:gpt-4")).toThrow(ModelConfigError);
    expect(() => parseChain("groq")).toThrow(ModelConfigError);
    expect(() => parseChain("groq:")).toThrow(ModelConfigError);
  });

  it("allows gemini in development and rejects it in production", () => {
    const env = { MODEL_JUDGE: "groq:qwen/qwen3.8-27b,gemini:gemini-3.5-flash-lite" };
    expect(loadModelConfig({ ...env, APP_ENV: "development" }).chains.judge).toHaveLength(2);
    expect(() => loadModelConfig({ ...env, APP_ENV: "production" })).toThrow(/MODEL_JUDGE/);
  });

  it("reads keys only from env", () => {
    const cfg = loadModelConfig({ GROQ_API_KEY: "k1", APP_ENV: "development" });
    expect(cfg.keys).toEqual({ groq: "k1" });
  });
});

describe("request settings", () => {
  it("sets low reasoning effort and a max_tokens cap for gpt-oss-120b", () => {
    const body = buildBody("rewrite", { provider: "groq", model: "openai/gpt-oss-120b" }, {
      ...REQUEST,
      maxTokens: 999_999,
    });
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_tokens).toBe(3000);
    expect(buildBody("rewrite", { provider: "groq", model: "openai/gpt-oss-120b" }, REQUEST).max_tokens).toBe(3000);
  });

  it("turns off thinking for the Qwen judge only", () => {
    expect(buildBody("judge", { provider: "groq", model: "qwen/qwen3.8-27b" }, REQUEST).reasoning_effort).toBe(
      "none",
    );
    expect(buildBody("vision", { provider: "groq", model: "qwen/qwen3.8-27b" }, REQUEST)).not.toHaveProperty(
      "reasoning_effort",
    );
  });
});

describe("chat", () => {
  const chain: ChainEntry[] = [
    { provider: "groq", model: "a" },
    { provider: "openrouter", model: "b" },
  ];

  it("stops on a 400 without trying the next entry", async () => {
    const { transport, calls } = fakeTransport(new Map<string, Behaviour>([
      ["a", { kind: "status", status: 400 }],
      ["b", { kind: "ok" }],
    ]));
    const client = createModelClient({ config: config(chain), transport, logger: noLog });
    await expect(client.chat("rewrite", REQUEST)).rejects.toBeInstanceOf(ProviderRequestError);
    expect(calls).toHaveLength(1);
  });

  it("skips an entry with no API key", async () => {
    const { transport, calls } = fakeTransport(new Map<string, Behaviour>([
      ["a", { kind: "ok" }],
      ["b", { kind: "ok" }],
    ]));
    const cfg = { ...config(chain), keys: { openrouter: "k" } };
    const result = await createModelClient({ config: cfg, transport, logger: noLog }).chat("rewrite", REQUEST);
    expect(result.model).toBe("b");
    expect(result.attempts[0].outcome).toBe("missing_key");
    expect(calls).toHaveLength(1);
  });

  it("aborts a hanging request after the timeout and moves on", async () => {
    const transport: Transport = (req) =>
      (req.body as { model: string }).model === "a"
        ? new Promise((_, reject) => {
            req.signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          })
        : Promise.resolve(okResponse());
    const result = await createModelClient({ config: config(chain), transport, timeoutMs: 10, logger: noLog }).chat(
      "rewrite",
      REQUEST,
    );
    expect(result.attempts.map((a) => a.outcome)).toEqual(["timeout", "ok"]);
  });

  it("reports the shortest Retry-After, capped at 20 seconds, when every entry fails", async () => {
    const transport: Transport = async (req) => ({
      status: 429,
      headers: { "retry-after": (req.body as { model: string }).model === "a" ? "90" : "7" },
      json: null,
    });
    const err = await createModelClient({ config: config(chain), transport, logger: noLog })
      .chat("rewrite", REQUEST)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderChainError);
    expect((err as ProviderChainError).retryAfterMs).toBe(7000);
    expect(parseRetryAfter("120")).toBe(120_000);
  });

  it("sends the key as a bearer header and logs no prompt, output or key", async () => {
    const events: ModelLogEvent[] = [];
    const { transport, calls } = fakeTransport(new Map<string, Behaviour>([
      ["a", { kind: "status", status: 503 }],
      ["b", { kind: "ok" }],
    ]));
    await createModelClient({ config: config(chain), transport, logger: (e) => events.push(e) }).chat(
      "judge",
      REQUEST,
    );
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEYS.groq}`);
    const logged = JSON.stringify(events);
    expect(events.map((e) => e.outcome)).toEqual(["server_error", "ok"]);
    for (const secret of ["PROMPT TEXT", "MODEL OUTPUT", ...Object.values(KEYS)]) {
      expect(logged).not.toContain(secret);
    }
  });
});
