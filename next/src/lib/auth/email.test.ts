/**
 * Security regression test: sendEmail must never log the recipient address
 * or the message body — the body carries the live password-reset token URL
 * for the reset flow, and the logger's key-based sanitizer would not catch
 * a token embedded in a free-form string like `text`.
 */
import { afterEach, describe, expect, it } from "vitest";

import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";

import { sendEmail } from "./email";

function captureSink() {
  const records: LogRecord[] = [];
  setLogSink((record) => {
    records.push(record);
  });
  return records;
}

afterEach(() => {
  resetLogSink();
});

describe("sendEmail — logging", () => {
  it("emits auth.email_dispatch_attempted with only the subject", async () => {
    const records = captureSink();

    await sendEmail({
      to: "user@example.com",
      subject: "Reset your password",
      text: "Click the link to reset your password: https://kizunia.test/reset?token=super-secret-token",
    });

    const event = records.find(
      (record) => record.event === "auth.email_dispatch_attempted",
    );

    expect(event).toBeDefined();
    expect(event?.level).toBe("info");
    expect(event?.fields).toEqual({ subject: "Reset your password" });
  });

  it("never includes the recipient or body anywhere in the emitted record", async () => {
    const records = captureSink();

    await sendEmail({
      to: "user@example.com",
      subject: "Reset your password",
      text: "Click the link to reset your password: https://kizunia.test/reset?token=super-secret-token",
    });

    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain("user@example.com");
    expect(serialized).not.toContain("super-secret-token");
  });
});
