import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpClient } from "./client";

function stubFetch() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));

  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function sentHeaders(fetchMock: ReturnType<typeof stubFetch>): Headers {
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];

  return new Headers(init.headers);
}

describe("HttpClient headers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps Content-Type when a caller adds a header to a POST", async () => {
    const fetchMock = stubFetch();

    await HttpClient.post("/x", { a: 1 }, { headers: { "Idempotency-Key": "key-123" } });

    const headers = sentHeaders(fetchMock);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe("key-123");
  });

  it("keeps the method and body when init is passed", async () => {
    const fetchMock = stubFetch();

    await HttpClient.post("/x", { a: 1 }, { headers: { "X-Test": "1" } });

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it("merges a Headers instance, not only a plain object", async () => {
    const fetchMock = stubFetch();

    await HttpClient.put("/x", { a: 1 }, { headers: new Headers({ "X-Test": "1" }) });

    const headers = sentHeaders(fetchMock);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Test")).toBe("1");
  });

  it("lets a caller override Content-Type", async () => {
    const fetchMock = stubFetch();

    await HttpClient.delete("/x", { headers: { "Content-Type": "text/plain" } });

    expect(sentHeaders(fetchMock).get("Content-Type")).toBe("text/plain");
  });
});
