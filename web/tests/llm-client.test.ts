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
  ProviderChainError,
  ProviderRequestError,
  BEDROCK_MAX_TOKENS,
  buildBody,
  createModelClient,
  loadModelConfig,
  parseChain,
  parseRetryAfter,
  providerBaseUrls,
} from "@/src/llm";

const KEYS = { bedrock: "test-bedrock-key", groq: "test-groq-key" };
const BASE_URLS = providerBaseUrls("eu-west-2");
const REQUEST = { messages: [{ role: "user" as const, content: "PROMPT TEXT" }] };

function okResponse(content = "MODEL OUTPUT"): TransportResponse {
  return {
    status: 200,
    headers: {},
    json: { choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] },
  };
}

function providerOf(url: string): Provider {
  const match = (Object.keys(BASE_URLS) as Provider[]).find((p) => url.startsWith(BASE_URLS[p]));
  if (!match) throw new Error(`unexpected url ${url}`);
  return match;
}

function config(chain: ChainEntry[], appEnv: "development" | "production" = "development"): ModelConfig {
  return {
    appEnv,
    chains: { rewrite: chain, judge: chain, vision: chain },
    keys: { ...KEYS },
    baseUrls: BASE_URLS,
  };
}

type Behaviour =
  | { kind: "ok" }
  | { kind: "status"; status: number }
  | { kind: "timeout" }
  | { kind: "network" };

const failure: fc.Arbitrary<Behaviour> = fc.oneof(
  fc.constant<Behaviour>({ kind: "status", status: 429 }),
  fc.integer({ min: 500, max: 599 }).map<Behaviour>((status) => ({ kind: "status", status })),
  // Key rejected, model access not granted, or model not offered in the Region.
  fc.constantFrom(401, 403, 404).map<Behaviour>((status) => ({ kind: "status", status })),
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
    const providers: fc.Arbitrary<Provider> = fc.constantFrom("bedrock", "groq");
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
   * Only Bedrock and Groq are ever called. A chain that names any other
   * provider, including the removed `gemini:` and `openrouter:`, fails at
   * start-up in every APP_ENV, so it never reaches the transport.
   * **Validates: Requirements 7.5 (supports); design "Model provider"**
   */
  it("rejects any provider other than bedrock and groq at start-up", () => {
    const name = fc.constantFrom("bedrock", "groq", "gemini", "openrouter", "openai", "anthropic");
    fc.assert(
      fc.property(
        fc.array(name, { minLength: 1, maxLength: 6 }),
        fc.constantFrom("development", "production"),
        (names, appEnv) => {
          const env = {
            APP_ENV: appEnv,
            MODEL_REWRITE: names.map((n, i) => `${n}:m${i}`).join(","),
          };
          const allowed = names.every((n) => n === "bedrock" || n === "groq");
          if (allowed) {
            expect(loadModelConfig(env).chains.rewrite.map((e) => e.provider)).toEqual(names);
          } else {
            expect(() => loadModelConfig(env)).toThrow(ModelConfigError);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe("config", () => {
  it("parses provider:model entries, keeping colons in the model ID", () => {
    expect(parseChain("bedrock:openai.gpt-oss-120b-1:0, groq:openai/gpt-oss-120b")).toEqual([
      { provider: "bedrock", model: "openai.gpt-oss-120b-1:0" },
      { provider: "groq", model: "openai/gpt-oss-120b" },
    ]);
  });

  it("rejects unknown providers and malformed entries", () => {
    expect(() => parseChain("openai:gpt-4")).toThrow(ModelConfigError);
    expect(() => parseChain("gemini:gemini-3.5-flash-lite")).toThrow(ModelConfigError);
    expect(() => parseChain("groq")).toThrow(ModelConfigError);
    expect(() => parseChain("groq:")).toThrow(ModelConfigError);
  });

  it("reads keys only from env", () => {
    const cfg = loadModelConfig({ GROQ_API_KEY: "k1", AWS_BEARER_TOKEN_BEDROCK: "k2", APP_ENV: "development" });
    expect(cfg.keys).toEqual({ bedrock: "k2", groq: "k1" });
  });

  it("calls Bedrock in London by default and validates AWS_REGION", () => {
    expect(loadModelConfig({}).baseUrls?.bedrock).toBe("https://bedrock-runtime.eu-west-2.amazonaws.com/openai/v1");
    expect(loadModelConfig({ AWS_REGION: "eu-west-1" }).baseUrls?.bedrock).toBe(
      "https://bedrock-runtime.eu-west-1.amazonaws.com/openai/v1",
    );
    expect(() => loadModelConfig({ AWS_REGION: "evil.example.com/x" })).toThrow(/AWS_REGION/);
  });
});

describe("request settings", () => {
  it("sets low reasoning effort and a max_tokens cap for gpt-oss-120b on Groq", () => {
    const body = buildBody("rewrite", { provider: "groq", model: "openai/gpt-oss-120b" }, {
      ...REQUEST,
      maxTokens: 999_999,
    });
    expect(body.reasoning_effort).toBe("low");
    expect(body.max_tokens).toBe(3000);
    expect(buildBody("rewrite", { provider: "groq", model: "openai/gpt-oss-120b" }, REQUEST).max_tokens).toBe(3000);
    expect(buildBody("rewrite", { provider: "bedrock", model: "openai.gpt-oss-120b-1:0" }, REQUEST)).toMatchObject({
      reasoning_effort: "low",
      max_tokens: BEDROCK_MAX_TOKENS,
    });
  });

  it("uses the Bedrock cap for every Bedrock model, whatever the task asks for", () => {
    for (const maxTokens of [2000, 2500, 999_999]) {
      const body = buildBody("judge", { provider: "bedrock", model: "qwen.qwen3-235b-a22b-2507-v1:0" }, {
        ...REQUEST,
        maxTokens,
      });
      expect(body.max_tokens).toBe(BEDROCK_MAX_TOKENS);
    }
    expect(
      buildBody("judge", { provider: "groq", model: "qwen/qwen3.8-27b" }, { ...REQUEST, maxTokens: 2500 }).max_tokens,
    ).toBe(2500);
  });

  it("turns off thinking for the Groq Qwen judge only", () => {
    expect(buildBody("judge", { provider: "groq", model: "qwen/qwen3.8-27b" }, REQUEST).reasoning_effort).toBe(
      "none",
    );
    expect(buildBody("vision", { provider: "groq", model: "qwen/qwen3.8-27b" }, REQUEST)).not.toHaveProperty(
      "reasoning_effort",
    );
    expect(
      buildBody("judge", { provider: "bedrock", model: "qwen.qwen3-235b-a22b-2507-v1:0" }, REQUEST),
    ).not.toHaveProperty("reasoning_effort");
  });
});

describe("chat", () => {
  const chain: ChainEntry[] = [
    { provider: "bedrock", model: "a" },
    { provider: "groq", model: "b" },
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

  it("falls back to Groq when Bedrock denies access or the model isn't in the Region", async () => {
    for (const status of [401, 403, 404]) {
      const { transport, calls } = fakeTransport(new Map<string, Behaviour>([
        ["a", { kind: "status", status }],
        ["b", { kind: "ok" }],
      ]));
      const result = await createModelClient({ config: config(chain), transport, logger: noLog }).chat(
        "rewrite",
        REQUEST,
      );
      expect(result.provider).toBe("groq");
      expect(result.attempts.map((a) => a.outcome)).toEqual(["unavailable", "ok"]);
      expect(calls.map((c) => providerOf(c.url))).toEqual(["bedrock", "groq"]);
    }
  });

  it("skips an entry with no API key", async () => {
    const { transport, calls } = fakeTransport(new Map<string, Behaviour>([
      ["a", { kind: "ok" }],
      ["b", { kind: "ok" }],
    ]));
    const cfg = { ...config(chain), keys: { groq: "k" } };
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
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEYS.bedrock}`);
    expect(calls[1].headers.authorization).toBe(`Bearer ${KEYS.groq}`);
    const logged = JSON.stringify(events);
    expect(events.map((e) => e.outcome)).toEqual(["server_error", "ok"]);
    for (const secret of ["PROMPT TEXT", "MODEL OUTPUT", ...Object.values(KEYS)]) {
      expect(logged).not.toContain(secret);
    }
  });
});
