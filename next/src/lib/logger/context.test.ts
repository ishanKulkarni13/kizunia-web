import { describe, expect, it } from "vitest";

import {
  getAmbientLogFields,
  getLogActorId,
  getLogRequestId,
  runWithLogContext,
  setLogActorId,
} from "./context";

describe("logger request context", () => {
  it("exposes the request id inside runWithLogContext, including in nested async calls", async () => {
    async function nested() {
      await Promise.resolve();
      return getLogRequestId();
    }

    const seen = await runWithLogContext("req-1", async () => nested());

    expect(seen).toBe("req-1");
  });

  it("has no request id outside an active context", () => {
    expect(getLogRequestId()).toBeUndefined();
    expect(getAmbientLogFields()).toEqual({});
  });

  it("records an actor id set inside the context and includes it in ambient fields", async () => {
    await runWithLogContext("req-2", async () => {
      setLogActorId("user-42");
      expect(getLogActorId()).toBe("user-42");
      expect(getAmbientLogFields()).toEqual({ requestId: "req-2", actorId: "user-42" });
    });
  });

  it("omits actorId from ambient fields when never set", async () => {
    await runWithLogContext("req-3", async () => {
      expect(getAmbientLogFields()).toEqual({ requestId: "req-3" });
    });
  });

  it("setLogActorId is a no-op outside any context (never throws)", () => {
    expect(() => setLogActorId("stray")).not.toThrow();
    expect(getLogActorId()).toBeUndefined();
  });

  it("ignores a null/undefined actor id", async () => {
    await runWithLogContext("req-4", async () => {
      setLogActorId(null);
      expect(getLogActorId()).toBeUndefined();
      setLogActorId(undefined);
      expect(getLogActorId()).toBeUndefined();
    });
  });

  it("does not leak context across concurrent, unrelated invocations", async () => {
    const results = await Promise.all([
      runWithLogContext("concurrent-a", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getLogRequestId();
      }),
      runWithLogContext("concurrent-b", async () => {
        return getLogRequestId();
      }),
    ]);

    expect(results).toEqual(["concurrent-a", "concurrent-b"]);
  });

  it("does not leak an actor id set in one context into a sibling context", async () => {
    const results = await Promise.all([
      runWithLogContext("actor-a", async () => {
        setLogActorId("user-a");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getLogActorId();
      }),
      runWithLogContext("actor-b", async () => {
        return getLogActorId();
      }),
    ]);

    expect(results).toEqual(["user-a", undefined]);
  });
});
