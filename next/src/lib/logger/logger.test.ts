import { afterEach, describe, expect, it, vi } from "vitest";

import { runWithLogContext } from "./context";
import { logger } from "./logger";
import type { LogRecord } from "./sink";
import { resetLogSink, setLogSink } from "./sink";

function captureSink() {
  const records: LogRecord[] = [];
  setLogSink((record) => {
    records.push(record);
  });
  return records;
}

describe("logger", () => {
  afterEach(() => {
    resetLogSink();
  });

  it("info() emits a record with the given level, event, and fields", () => {
    const records = captureSink();

    logger.info("competition.created", { competitionId: "c1" });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: "info",
      event: "competition.created",
      fields: { competitionId: "c1" },
    });
    expect(records[0].timestamp).toEqual(expect.any(String));
  });

  it("warn() emits at the warn level", () => {
    const records = captureSink();

    logger.warn("cache.miss", { key: "k1" });

    expect(records[0].level).toBe("warn");
  });

  it("error() requires and normalizes the error, merging it into fields", () => {
    const records = captureSink();

    logger.error("job.failed", new Error("boom"), { jobId: "j1" });

    expect(records[0].level).toBe("error");
    expect(records[0].fields.jobId).toBe("j1");
    expect(records[0].fields.error).toMatchObject({ message: "boom", name: "Error" });
  });

  it("sanitizes fields before they reach the sink", () => {
    const records = captureSink();

    logger.info("auth.attempt", { password: "hunter2", userId: "u1" });

    expect(records[0].fields).toEqual({ password: "[REDACTED]", userId: "u1" });
  });

  it("child() merges bindings into every subsequent call", () => {
    const records = captureSink();

    const child = logger.child({ requestId: "r1", tool: "search" });
    child.info("mcp.tool.succeeded", { durationMs: 12 });
    child.warn("mcp.tool.slow", {});

    expect(records[0].fields).toMatchObject({ requestId: "r1", tool: "search", durationMs: 12 });
    expect(records[1].fields).toMatchObject({ requestId: "r1", tool: "search" });
  });

  it("child() bindings do not leak into calls made on the unbound logger", () => {
    const records = captureSink();

    const child = logger.child({ scoped: true });
    child.info("scoped.event", {});
    logger.info("unscoped.event", {});

    expect(records[0].fields).toMatchObject({ scoped: true });
    expect(records[1].fields).not.toHaveProperty("scoped");
  });

  it("merges ambient request context automatically", async () => {
    const records = captureSink();

    await runWithLogContext("req-abc", async () => {
      logger.info("delivery.pass", { notificationId: "n1" });
    });

    expect(records[0].fields).toMatchObject({ requestId: "req-abc", notificationId: "n1" });
  });

  it("explicit fields take precedence over child bindings on conflict", () => {
    const records = captureSink();

    const child = logger.child({ notificationId: "n1" });
    child.info("generation.created", { notificationId: "n2" });

    expect(records[0].fields.notificationId).toBe("n2");
  });

  it("a throwing sink does not propagate to the caller", () => {
    setLogSink(() => {
      throw new Error("sink exploded");
    });

    expect(() => logger.info("anything", {})).not.toThrow();
  });

  it("accepts an async sink (a hosted provider's SDK) without the caller awaiting anything", () => {
    let resolveSink!: () => void;
    const sinkCalled = new Promise<void>((resolve) => {
      resolveSink = resolve;
    });

    setLogSink(async () => {
      resolveSink();
    });

    expect(() => logger.info("shipped.to.provider", {})).not.toThrow();
    return sinkCalled;
  });

  it("a rejecting async sink does not produce an unhandled rejection", async () => {
    setLogSink(() => Promise.reject(new Error("provider unreachable")));

    expect(() => logger.error("anything", new Error("x"))).not.toThrow();

    // Let the microtask queue settle so the rejection is observed and
    // handled internally rather than surfacing as an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("setLogSink/resetLogSink swap the destination cleanly", () => {
    const spy = vi.fn();
    setLogSink(spy);

    logger.info("x", {});
    expect(spy).toHaveBeenCalledTimes(1);

    resetLogSink();

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    logger.info("y", {});
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
