// Responses → Chat: reasoning_text must become reasoning_content (stream + non-stream).
// Protocol-generic — no model-name branching.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

describe("Responses reasoning_text → Chat Completions", () => {
  it("stream: reasoning_text.delta → delta.reasoning_content", () => {
    const state = initState(FORMATS.OPENAI);
    const chunk = translateResponse(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI,
      { type: "response.reasoning_text.delta", delta: "think-hard" },
      state
    );
    const list = Array.isArray(chunk) ? chunk : [chunk];
    expect(list[0]?.choices?.[0]?.delta?.reasoning_content).toBe("think-hard");
  });

  it("non-stream: output reasoning_text parts → message.reasoning_content", () => {
    const body = {
      id: "resp_test",
      object: "response",
      created_at: 1700000000,
      model: "any-model",
      status: "completed",
      output: [
        {
          type: "reasoning",
          id: "rs_1",
          content: [{ type: "reasoning_text", text: "hidden thoughts" }],
          summary: [],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "final answer", annotations: [] }],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    };
    // targetFormat=provider (responses), sourceFormat=client (openai/chat)
    const out = translateNonStreamingResponse(body, FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI);
    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.content).toBe("final answer");
    expect(out.choices[0].message.reasoning_content).toBe("hidden thoughts");
  });
});
