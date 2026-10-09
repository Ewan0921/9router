import { describe, expect, it } from "vitest";
import "../translator/registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

const RESPONSES_PROVIDER = "openai-compatible-responses-fast";
const CHAT_PROVIDER = "openai-compatible-chat-fast";

const TOOLS = [{
  type: "function",
  function: {
    name: "lookup",
    description: "Look something up",
    parameters: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
  },
}];

function chat(messages, extra = {}) {
  return {
    model: "gpt-6-astra",
    messages,
    tools: TOOLS,
    ...extra,
  };
}

const BASE_MESSAGES = [
  { role: "system", content: "You are a careful assistant." },
  { role: "developer", content: "Prefer short answers." },
  { role: "user", content: "What is the capital of France?" },
];

describe("Responses reasoning.effort", () => {
  it("nests a flat reasoning_effort and drops the top-level field", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-6-astra",
      chat(BASE_MESSAGES, { reasoning_effort: "high" }),
      true,
      {},
      RESPONSES_PROVIDER,
    );

    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toMatchObject({ effort: "high" });
    expect(out.input).toBeTruthy();
    expect(out.instructions).toContain("careful assistant");
  });

  it("merges flat effort into an existing reasoning object and keeps summary", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-6-astra",
      chat(BASE_MESSAGES, {
        reasoning_effort: "high",
        reasoning: { effort: "low", summary: "detailed" },
      }),
      true,
      {},
      RESPONSES_PROVIDER,
    );

    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning.effort).toBe("high");
    expect(out.reasoning.summary).toBe("detailed");
  });

  it("reads effort from a reasoning object when reasoning_effort is absent", () => {
    const out = openaiToOpenAIResponsesRequest("gpt-6-astra", chat(BASE_MESSAGES, {
      reasoning: { effort: "medium", summary: "concise" },
    }), true, {});

    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toEqual({ effort: "medium", summary: "concise" });
  });

  it("applies a model thinking-level suffix on an openai-compatible Responses target", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-6-astra(high)",
      chat([{ role: "user", content: "Think hard." }]),
      true,
      {},
      RESPONSES_PROVIDER,
    );

    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning.effort).toBe("high");
  });

  it("leaves Chat Completions reasoning_effort flat", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-6-astra",
      chat([{ role: "user", content: "hi" }], { reasoning_effort: "high" }),
      true,
      {},
      CHAT_PROVIDER,
    );

    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning).toBeUndefined();
    expect(out.messages).toBeTruthy();
  });

  it("keeps Codex on flat reasoning_effort and does not invent a cache key", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.6-sol",
      {
        messages: [{ role: "user", content: "hi" }],
        reasoning_effort: "high",
      },
      true,
      {},
      "codex",
    );

    expect(out.reasoning_effort).toBe("high");
    expect(out.prompt_cache_key).toBeUndefined();
  });
});

describe("prompt_cache_key", () => {
  it("passes a client key through chat → responses", () => {
    const out = openaiToOpenAIResponsesRequest(
      "gpt-6-astra",
      chat(BASE_MESSAGES, { prompt_cache_key: "client-key" }),
      true,
      {},
    );

    expect(out.prompt_cache_key).toBe("client-key");
  });

  it("keeps a client key on Chat Completions", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-4o",
      {
        messages: [{ role: "user", content: "hi" }],
        prompt_cache_key: "client-key",
      },
      false,
      {},
      CHAT_PROVIDER,
    );

    expect(out.prompt_cache_key).toBe("client-key");
  });

  it("mints one stable key for a growing conversation and a different key for another first user message", () => {
    const turn1 = openaiToOpenAIResponsesRequest("gpt-6-astra", chat(BASE_MESSAGES), true, {});
    const turn2 = openaiToOpenAIResponsesRequest("gpt-6-astra", chat([
      ...BASE_MESSAGES,
      { role: "assistant", content: "Paris." },
      { role: "user", content: "And the river?" },
      { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{\"q\":\"seine\"}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "The Seine." },
      { role: "user", content: "Thanks." },
    ]), true, {});
    const other = openaiToOpenAIResponsesRequest("gpt-6-astra", chat([
      BASE_MESSAGES[0],
      BASE_MESSAGES[1],
      { role: "user", content: "What is the capital of Spain?" },
    ]), true, {});

    expect(turn1.prompt_cache_key).toMatch(/^9r-[a-f0-9]{32}$/);
    expect(turn2.prompt_cache_key).toBe(turn1.prompt_cache_key);
    expect(other.prompt_cache_key).toMatch(/^9r-[a-f0-9]{32}$/);
    expect(other.prompt_cache_key).not.toBe(turn1.prompt_cache_key);
    expect(turn1.prompt_cache_key).not.toContain("France");
    expect(turn1.prompt_cache_key).not.toContain("careful assistant");
  });

  it("does not override a client key on a later turn", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI_RESPONSES,
      "gpt-6-astra",
      chat([
        ...BASE_MESSAGES,
        { role: "assistant", content: "Paris." },
        { role: "user", content: "And the river?" },
      ], { prompt_cache_key: "client-key" }),
      true,
      {},
      RESPONSES_PROVIDER,
    );

    expect(out.prompt_cache_key).toBe("client-key");
  });

  it("skips the key when there is no user message", () => {
    const out = openaiToOpenAIResponsesRequest("gpt-6-astra", {
      messages: [{ role: "system", content: "instructions only" }],
    }, true, {});

    expect(out.prompt_cache_key).toBeUndefined();
  });
});

describe("openai-compatible Responses executor", () => {
  it("nests a leftover reasoning_effort and mints a cache key", () => {
    const exec = new DefaultExecutor(RESPONSES_PROVIDER);
    const out = exec.transformRequest("gpt-6-astra", {
      model: "gpt-6-astra",
      instructions: "You are a careful assistant.",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      reasoning_effort: "high",
      reasoning: { summary: "concise" },
      store: false,
      stream: true,
    });

    expect(out.reasoning_effort).toBeUndefined();
    expect(out.reasoning).toEqual({ summary: "concise", effort: "high" });
    expect(out.prompt_cache_key).toMatch(/^9r-[a-f0-9]{32}$/);
  });

  it("does not rewrite Chat Completions bodies", () => {
    const exec = new DefaultExecutor(CHAT_PROVIDER);
    const out = exec.transformRequest("gpt-6-astra", {
      model: "gpt-6-astra",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
    });

    expect(out.reasoning_effort).toBe("high");
    expect(out.reasoning).toBeUndefined();
    expect(out.prompt_cache_key).toBeUndefined();
  });
});
