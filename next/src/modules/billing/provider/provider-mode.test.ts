import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { resetLogSink, setLogSink, type LogRecord } from "@/lib/logger";

import { BillingConfigurationError } from "../errors/billing-configuration-error";
import { BillingUnavailableError } from "../errors/billing-unavailable-error";
import {
  assertBillingProviderEnabled,
  getProviderConfiguration,
  getProviderMode,
  isBillingProviderEnabled,
  resetProviderConfigurationForTests,
  resolveProviderConfiguration,
  validateBillingConfigurationAtBoot,
} from "./provider-mode";

const KEY_SECRET = "s3cr3t-key-secret-value";
const WEBHOOK_SECRET = "s3cr3t-webhook-secret-value";

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

/** A complete, valid environment for the given mode, overridable per test. */
function credentials(
  mode: "test" | "live",
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return env({
    RAZORPAY_KEY_ID: `rzp_${mode}_AbCdEf123456`,
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RAZORPAY_ACCOUNT_ID: "acc_TestAccount01",
    ...overrides,
  });
}

function messageOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error("expected the action to throw");
}

describe("resolveProviderConfiguration — disabled", () => {
  it("is DISABLED when no billing credentials are configured", () => {
    expect(resolveProviderConfiguration(env({}), "TEST")).toEqual({ mode: "DISABLED" });
    expect(resolveProviderConfiguration(env({}), "LIVE")).toEqual({ mode: "DISABLED" });
  });

  it("treats blank credentials as absent, not as a partial configuration", () => {
    const blank = env({
      RAZORPAY_KEY_ID: "  ",
      RAZORPAY_KEY_SECRET: "",
      RAZORPAY_WEBHOOK_SECRET: undefined,
    });

    expect(resolveProviderConfiguration(blank, "TEST")).toEqual({ mode: "DISABLED" });
  });

  it("is not an error for a LIVE-expected deployment to have no credentials", () => {
    // A production deployment without credentials keeps honoring its LIVE
    // subscriptions; it is a supported state (SB-PB-03).
    expect(resolveProviderConfiguration(env({}), "LIVE").mode).toBe("DISABLED");
  });
});

describe("resolveProviderConfiguration — partial credentials fail fast", () => {
  const cases: Array<[string, string[]]> = [
    ["RAZORPAY_KEY_ID", ["RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]],
    ["RAZORPAY_KEY_SECRET", ["RAZORPAY_KEY_ID", "RAZORPAY_WEBHOOK_SECRET"]],
    ["RAZORPAY_WEBHOOK_SECRET", ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]],
  ];

  it.each(cases)("only %s set: names what is missing", (only, missing) => {
    const partial = env({ [only]: only === "RAZORPAY_KEY_ID" ? "rzp_test_abc" : "value" });
    const message = messageOf(() => resolveProviderConfiguration(partial, "TEST"));

    for (const name of missing) expect(message).toContain(name);
    expect(message).toContain("or none of them");
  });

  it("key id and secret without a webhook secret is partial", () => {
    // The shape of a developer .env that predates webhooks.
    const partial = env({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: KEY_SECRET });
    const error = (() => {
      try {
        resolveProviderConfiguration(partial, "TEST");
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(BillingConfigurationError);
    expect((error as Error).message).toContain("RAZORPAY_WEBHOOK_SECRET");
    expect((error as Error).message).not.toContain(KEY_SECRET);
  });
});

describe("resolveProviderConfiguration — the key decides the mode", () => {
  it("resolves a test key to TEST", () => {
    const configuration = resolveProviderConfiguration(credentials("test"), "TEST");

    expect(configuration.mode).toBe("TEST");
  });

  it("resolves a live key to LIVE", () => {
    expect(resolveProviderConfiguration(credentials("live"), "LIVE").mode).toBe("LIVE");
  });

  it("carries the credentials of an enabled configuration", () => {
    const configuration = resolveProviderConfiguration(credentials("test"), "TEST");

    expect(configuration).toEqual({
      mode: "TEST",
      razorpay: {
        keyId: "rzp_test_AbCdEf123456",
        keySecret: KEY_SECRET,
        webhookSecret: WEBHOOK_SECRET,
        accountId: "acc_TestAccount01",
        previousWebhookSecret: null,
        previousWebhookSecretUntil: null,
      },
    });
  });

  it("fails on a key that matches neither prefix, without echoing it", () => {
    const message = messageOf(() =>
      resolveProviderConfiguration(credentials("test", { RAZORPAY_KEY_ID: "sk_live_wrongvendor" }), "TEST"),
    );

    expect(message).toContain("rzp_test_");
    expect(message).toContain("rzp_live_");
    expect(message).not.toContain("sk_live_wrongvendor");
  });

  it("fails on a key with the right shape but the wrong case of prefix", () => {
    expect(() =>
      resolveProviderConfiguration(credentials("test", { RAZORPAY_KEY_ID: "RZP_TEST_abc" }), "TEST"),
    ).toThrow(BillingConfigurationError);
  });

  it("requires the account id once credentials are set", () => {
    expect(() =>
      resolveProviderConfiguration(credentials("test", { RAZORPAY_ACCOUNT_ID: undefined }), "TEST"),
    ).toThrow(/RAZORPAY_ACCOUNT_ID is required/);
  });
});

describe("resolveProviderConfiguration — resolved mode must match the expected mode", () => {
  it("refuses TEST credentials in a LIVE-expected deployment", () => {
    const message = messageOf(() => resolveProviderConfiguration(credentials("test"), "LIVE"));

    expect(message).toContain("TEST mode");
    expect(message).toContain("expects LIVE");
    expect(message).toContain("BILLING_EXPECTED_MODE");
  });

  it("refuses LIVE credentials in a TEST-expected deployment", () => {
    const message = messageOf(() => resolveProviderConfiguration(credentials("live"), "TEST"));

    expect(message).toContain("LIVE mode");
    expect(message).toContain("expects TEST");
  });

  it("never puts a secret in the message", () => {
    const message = messageOf(() => resolveProviderConfiguration(credentials("live"), "TEST"));

    expect(message).not.toContain(KEY_SECRET);
    expect(message).not.toContain(WEBHOOK_SECRET);
    expect(message).not.toContain("AbCdEf123456");
  });

  it("derives the expected mode from the environment when it is not passed", () => {
    // Test credentials on a Vercel production deployment: the classic mix-up.
    expect(() =>
      resolveProviderConfiguration(credentials("test", { VERCEL_ENV: "production" })),
    ).toThrow(/expects LIVE/);

    expect(
      resolveProviderConfiguration(credentials("live", { VERCEL_ENV: "production" })).mode,
    ).toBe("LIVE");

    // An explicit expected mode wins over VERCEL_ENV.
    expect(
      resolveProviderConfiguration(
        credentials("test", { VERCEL_ENV: "production", BILLING_EXPECTED_MODE: "test" }),
      ).mode,
    ).toBe("TEST");
  });
});

describe("resolveProviderConfiguration — webhook secret rotation", () => {
  it("accepts a previous secret with a window", () => {
    const configuration = resolveProviderConfiguration(
      credentials("test", {
        RAZORPAY_WEBHOOK_SECRET_PREVIOUS: "old-webhook-secret",
        RAZORPAY_WEBHOOK_SECRET_PREVIOUS_UNTIL: "2026-10-01T00:00:00Z",
      }),
      "TEST",
    );

    if (configuration.mode === "DISABLED") throw new Error("expected an enabled configuration");

    expect(configuration.razorpay.previousWebhookSecret).toBe("old-webhook-secret");
    expect(configuration.razorpay.previousWebhookSecretUntil?.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("accepts a previous secret with no window: it stays until it is removed", () => {
    const configuration = resolveProviderConfiguration(
      credentials("test", { RAZORPAY_WEBHOOK_SECRET_PREVIOUS: "old-webhook-secret" }),
      "TEST",
    );

    if (configuration.mode === "DISABLED") throw new Error("expected an enabled configuration");

    expect(configuration.razorpay.previousWebhookSecretUntil).toBeNull();
  });

  it("refuses a window without a previous secret", () => {
    expect(() =>
      resolveProviderConfiguration(
        credentials("test", { RAZORPAY_WEBHOOK_SECRET_PREVIOUS_UNTIL: "2026-10-01T00:00:00Z" }),
        "TEST",
      ),
    ).toThrow(/PREVIOUS_UNTIL is set without RAZORPAY_WEBHOOK_SECRET_PREVIOUS/);
  });

  it("refuses a window that is not a date", () => {
    expect(() =>
      resolveProviderConfiguration(
        credentials("test", {
          RAZORPAY_WEBHOOK_SECRET_PREVIOUS: "old",
          RAZORPAY_WEBHOOK_SECRET_PREVIOUS_UNTIL: "next tuesday",
        }),
        "TEST",
      ),
    ).toThrow(/not a valid date/);
  });
});

describe("boot validation and the runtime seam", () => {
  let records: LogRecord[];

  beforeEach(() => {
    records = [];
    setLogSink((record) => {
      records.push(record);
    });
    resetProviderConfigurationForTests();

    // Whatever the machine running the tests has configured must not leak in.
    for (const name of [
      "RAZORPAY_KEY_ID",
      "RAZORPAY_KEY_SECRET",
      "RAZORPAY_WEBHOOK_SECRET",
      "RAZORPAY_ACCOUNT_ID",
      "RAZORPAY_WEBHOOK_SECRET_PREVIOUS",
      "RAZORPAY_WEBHOOK_SECRET_PREVIOUS_UNTIL",
      "BILLING_EXPECTED_MODE",
      "VERCEL_ENV",
    ]) {
      vi.stubEnv(name, "");
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetLogSink();
    resetProviderConfigurationForTests();
  });

  function stub(values: Record<string, string | undefined>) {
    for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value ?? "");
  }

  it("boots with no billing configuration, and billing is disabled", () => {
    const configuration = validateBillingConfigurationAtBoot();

    expect(configuration).toEqual({ mode: "DISABLED" });
    expect(isBillingProviderEnabled()).toBe(false);
    expect(getProviderMode()).toBe("DISABLED");
  });

  it("logs the resolved and expected mode, and never a key or secret", () => {
    stub(credentials("test"));

    validateBillingConfigurationAtBoot();

    const resolved = records.find((record) => record.event === "mode.resolved");

    expect(resolved?.fields).toMatchObject({ module: "billing", mode: "TEST", expectedMode: "TEST" });

    const everything = JSON.stringify(records);
    expect(everything).not.toContain(KEY_SECRET);
    expect(everything).not.toContain(WEBHOOK_SECRET);
    expect(everything).not.toContain("rzp_test_AbCdEf123456");
  });

  it("raises a low-severity alert, without failing, when a LIVE deployment has no credentials", () => {
    stub({ VERCEL_ENV: "production" });

    expect(validateBillingConfigurationAtBoot()).toEqual({ mode: "DISABLED" });

    const alert = records.find((record) => record.event === "billing.alert");

    expect(alert?.fields).toMatchObject({
      condition: "PROVIDER_DISABLED_IN_PRODUCTION",
      severity: "LOW",
    });
  });

  it("raises no alert for a disabled TEST deployment", () => {
    validateBillingConfigurationAtBoot();

    expect(records.some((record) => record.event === "billing.alert")).toBe(false);
  });

  it("fails boot on a misconfiguration and does not cache a result", () => {
    stub({ RAZORPAY_KEY_ID: "rzp_test_abc" });

    expect(() => validateBillingConfigurationAtBoot()).toThrow(BillingConfigurationError);
    // Not silently degraded to DISABLED afterwards.
    expect(() => getProviderConfiguration()).toThrow(BillingConfigurationError);
  });

  it("fails boot when the credentials do not match the expected mode", () => {
    stub({ ...credentials("test"), VERCEL_ENV: "production" });

    expect(() => validateBillingConfigurationAtBoot()).toThrow(/expects LIVE/);
  });

  it("memoizes: a later environment change does not re-resolve the mode", () => {
    validateBillingConfigurationAtBoot();
    stub(credentials("test"));

    expect(isBillingProviderEnabled()).toBe(false);
  });

  it("reports enabled once credentials resolve", () => {
    stub(credentials("test"));
    validateBillingConfigurationAtBoot();

    expect(isBillingProviderEnabled()).toBe(true);
    expect(() => assertBillingProviderEnabled()).not.toThrow();
  });

  it("answers a disabled deployment with 503 BILLING_UNAVAILABLE and nothing else", () => {
    validateBillingConfigurationAtBoot();

    const error = (() => {
      try {
        assertBillingProviderEnabled();
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(BillingUnavailableError);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      status: 503,
      code: "BILLING_UNAVAILABLE",
      retryable: true,
      message: "Paid subscriptions are temporarily unavailable.",
    });
  });
});
