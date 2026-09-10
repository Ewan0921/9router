// Cursor (and some OpenAI SDKs) echo streaming/history extras that are not valid
// Chat Completions request fields. Strict openai-compatible gateways 400 with
//   messages.N.tool_calls.0.index
//   messages.N.content.0.image_url.dimensions
import { describe, it, expect } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { filterToOpenAIFormat } from "../../open-sse/translator/formats/openai.js";

const PNG = "data:image/png;base64,AAAA";

describe("filterToOpenAIFormat Cursor extras", () => {
  it("strips tool_calls[].index from assistant history (streaming leftover)", () => {
    const body = {
      messages: [
        { role: "user", content: "run" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "Read", arguments: "{\"path\":\"a.js\"}" },
            },
            {
              index: "1",
              id: "call_2",
              type: "function",
              function: { name: "Grep", arguments: "{\"q\":\"x\"}" },
            },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "ok" },
      ],
    };

    const result = filterToOpenAIFormat(JSON.parse(JSON.stringify(body)));
    const tcs = result.messages[1].tool_calls;
    expect(tcs).toHaveLength(2);
    expect(tcs[0]).toEqual({
      id: "call_1",
      type: "function",
      function: { name: "Read", arguments: "{\"path\":\"a.js\"}" },
    });
    expect(tcs[1]).not.toHaveProperty("index");
    expect(tcs[1].id).toBe("call_2");
  });

  it("strips image_url.dimensions and keeps url + detail", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: PNG,
                detail: "high",
                dimensions: { width: 1920, height: 1080 },
              },
            },
            { type: "text", text: "what is this?" },
          ],
        },
      ],
    };

    const result = filterToOpenAIFormat(JSON.parse(JSON.stringify(body)));
    const img = result.messages[0].content.find((b) => b.type === "image_url");
    expect(img.image_url).toEqual({ url: PNG, detail: "high" });
    expect(img.image_url).not.toHaveProperty("dimensions");
  });

  it("drops invalid image_url.detail and string/object dimensions", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: PNG, detail: "original", dimensions: "1920x1080" },
            },
          ],
        },
      ],
    };

    const result = filterToOpenAIFormat(JSON.parse(JSON.stringify(body)));
    expect(result.messages[0].content[0].image_url).toEqual({ url: PNG });
  });

  it("moves image parts from tool results to a following user message", () => {
    const body = {
      messages: [
        {
          role: "tool",
          tool_call_id: "call_1",
          content: [
            { type: "text", text: "Read image file: page_01.png" },
            {
              type: "image_url",
              image_url: { url: PNG, dimensions: { width: 10, height: 10 } },
            },
          ],
        },
      ],
    };

    const result = filterToOpenAIFormat(JSON.parse(JSON.stringify(body)));
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: [{ type: "text", text: "Read image file: page_01.png" }],
    });
    expect(result.messages[1]).toEqual({
      role: "user",
      content: [{ type: "image_url", image_url: { url: PNG } }],
    });
  });

  it("emits relocated images only after the whole parallel tool-result run", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "ReadFile", arguments: "{}" } },
            { id: "call_2", type: "function", function: { name: "Read", arguments: "{}" } },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: [
            { type: "text", text: "Read image file: page_01.png" },
            { type: "image_url", image_url: { url: PNG } },
          ],
        },
        { role: "tool", tool_call_id: "call_2", content: "file body" },
      ],
    };

    const result = filterToOpenAIFormat(JSON.parse(JSON.stringify(body)));
    expect(result.messages.map((m) => m.role)).toEqual(["assistant", "tool", "tool", "user"]);
    expect(result.messages[2].content).toBe("file body");
    expect(result.messages[3].content).toEqual([
      { type: "image_url", image_url: { url: PNG } },
    ]);
  });

  it("keeps reasoning_content on assistant tool-call turns", () => {
    const body = {
      messages: [
        {
          role: "assistant",
          content: null,
          reasoning_content: "plan",
          tool_calls: [
            { index: 0, id: "call_1", type: "function", function: { name: "x", arguments: "{}" } },
          ],
        },
      ],
    };

    const result = filterToOpenAIFormat(JSON.parse(JSON.stringify(body)));
    expect(result.messages[0].reasoning_content).toBe("plan");
    expect(result.messages[0].content).toBeNull();
    expect(result.messages[0].tool_calls[0]).not.toHaveProperty("index");
  });

  it("translateRequest openai→openai strips both extras before upstream", () => {
    const body = {
      model: "gpt-5.6-sol",
      messages: [
        { role: "system", content: "sys" },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: PNG, detail: "auto", dimensions: { width: 8, height: 8 } },
            },
          ],
        },
        { role: "user", content: "go" },
        {
          role: "assistant",
          tool_calls: [
            { index: 0, id: "call_a", type: "function", function: { name: "Read", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "call_a", content: "ok" },
        { role: "user", content: "continue" },
      ],
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-5.6-sol",
      JSON.parse(JSON.stringify(body)),
      true,
      null,
      "openai-compatible-chat-test",
    );

    const img = result.messages[1].content[0].image_url;
    expect(img).toEqual({ url: PNG, detail: "auto" });
    expect(result.messages[3].tool_calls[0]).toEqual({
      id: "call_a",
      type: "function",
      function: { name: "Read", arguments: "{}" },
    });
  });

  it("translateRequest openai→openai relocates tool-result images before upstream", () => {
    const body = {
      model: "gpt-5.6-luna",
      messages: [
        { role: "user", content: "read that page" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_img", type: "function", function: { name: "ReadFile", arguments: "{}" } },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_img",
          content: [
            { type: "text", text: "Read image file: page_01.png" },
            {
              type: "image_url",
              image_url: { url: PNG, dimensions: { width: 8, height: 8 } },
            },
          ],
        },
      ],
    };

    const result = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-5.6-luna",
      JSON.parse(JSON.stringify(body)),
      true,
      null,
      "openai-compatible-chat-test",
    );

    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
    expect(result.messages[2].content).toEqual([
      { type: "text", text: "Read image file: page_01.png" },
    ]);
    expect(result.messages[3].content).toEqual([
      { type: "image_url", image_url: { url: PNG } },
    ]);
  });
});
