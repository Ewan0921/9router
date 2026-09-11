import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestDetails: vi.fn(),
}));

vi.mock("@/lib/usageDb", () => ({
  getRequestDetails: mocks.getRequestDetails,
}));

const { GET } = await import("@/app/api/usage/request-details/route.js");

function makeReq(query = "page=1&pageSize=20") {
  return new Request(`http://localhost/api/usage/request-details?${query}`);
}

const SAMPLE_DETAIL = {
  id: "abc",
  provider: "opencode",
  model: "deepseek-v4-flash-free",
  timestamp: "2026-08-05T00:00:00Z",
  status: "success",
  tokens: { prompt_tokens: 10, completion_tokens: 5 },
  request: { messages: [{ role: "user", content: "secret prompt" }] },
  providerRequest: { messages: [{ role: "user", content: "secret prompt" }] },
  providerResponse: { choices: [{ message: { content: "secret answer" } }] },
  response: { content: "secret answer" },
};

describe("request-details API payloads", () => {
  beforeEach(() => {
    mocks.getRequestDetails.mockReset();
  });

  it("returns conversation payloads unredacted for the dashboard owner", async () => {
    mocks.getRequestDetails.mockResolvedValue({
      details: [SAMPLE_DETAIL],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });

    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const out = (await res.json()).details[0];
    expect(out.id).toBe("abc");
    expect(out.provider).toBe("opencode");
    expect(out.model).toBe("deepseek-v4-flash-free");
    expect(out.tokens).toEqual({ prompt_tokens: 10, completion_tokens: 5 });
    expect(out.request).toEqual(SAMPLE_DETAIL.request);
    expect(out.providerRequest).toEqual(SAMPLE_DETAIL.providerRequest);
    expect(out.providerResponse).toEqual(SAMPLE_DETAIL.providerResponse);
    expect(out.response).toEqual(SAMPLE_DETAIL.response);
    expect(out.request).not.toEqual({ redacted: true });
    expect(out.response).not.toEqual({ redacted: true });
  });

  it("handles empty details", async () => {
    mocks.getRequestDetails.mockResolvedValue({
      details: [],
      pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
    });
    const res = await GET(makeReq());
    const body = await res.json();
    expect(body.details).toEqual([]);
  });

  it("keeps non-sensitive fields untouched", async () => {
    mocks.getRequestDetails.mockResolvedValue({
      details: [{ id: "x", status: "error", latency: { total: 100 } }],
      pagination: { page: 1, pageSize: 20 },
    });
    const res = await GET(makeReq());
    const out = (await res.json()).details[0];
    expect(out.id).toBe("x");
    expect(out.status).toBe("error");
    expect(out.latency).toEqual({ total: 100 });
  });
});
