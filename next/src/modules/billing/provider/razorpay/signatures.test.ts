import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  hmacSha256Hex,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  type WebhookSecret,
} from "./signatures";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const BODY = '{"entity":"event","event":"subscription.charged","payload":{"n":1}}';

const current: WebhookSecret = { secret: "current-secret", label: "CURRENT", validUntil: null };
const previous = (validUntil: Date | null): WebhookSecret => ({
  secret: "previous-secret",
  label: "PREVIOUS",
  validUntil,
});

function sign(secret: string, body: string | Uint8Array = BODY): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

describe("hmacSha256Hex", () => {
  it("matches the published HMAC-SHA256 test vector", () => {
    // The standard example: key "key", message "The quick brown fox jumps over the lazy dog".
    expect(hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });
});

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature made with the current secret", () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, signature: sign("current-secret"), secrets: [current], now: NOW }),
    ).toEqual({ valid: true, matchedSecret: "CURRENT" });
  });

  it("rejects a signature made with a different secret", () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, signature: sign("wrong-secret"), secrets: [current], now: NOW }),
    ).toEqual({ valid: false });
  });

  it("rejects a body that was changed after signing", () => {
    const signature = sign("current-secret");

    expect(
      verifyWebhookSignature({ rawBody: BODY.replace('"n":1', '"n":2'), signature, secrets: [current], now: NOW }),
    ).toEqual({ valid: false });
  });

  it("verifies the raw bytes, so whitespace that a JSON parse would erase still counts", () => {
    const signature = sign("current-secret");

    expect(
      verifyWebhookSignature({ rawBody: `${BODY} `, signature, secrets: [current], now: NOW }),
    ).toEqual({ valid: false });
  });

  it("accepts the body as bytes as well as text", () => {
    const bytes = new TextEncoder().encode(BODY);

    expect(
      verifyWebhookSignature({ rawBody: bytes, signature: sign("current-secret", bytes), secrets: [current], now: NOW }),
    ).toEqual({ valid: true, matchedSecret: "CURRENT" });
  });

  it("rejects a missing, empty or malformed signature", () => {
    for (const signature of [null, undefined, "", "   ", "not-hex", sign("current-secret").slice(0, 10)]) {
      expect(verifyWebhookSignature({ rawBody: BODY, signature, secrets: [current], now: NOW })).toEqual({
        valid: false,
      });
    }
  });

  it("tolerates upper-case hex and surrounding whitespace in the header", () => {
    const signature = `  ${sign("current-secret").toUpperCase()} `;

    expect(verifyWebhookSignature({ rawBody: BODY, signature, secrets: [current], now: NOW })).toEqual({
      valid: true,
      matchedSecret: "CURRENT",
    });
  });

  it("fails closed when no secret is configured", () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, signature: sign("anything"), secrets: [], now: NOW }),
    ).toEqual({ valid: false });
  });

  it("accepts the previous secret inside its rotation window, and says so", () => {
    const secrets = [current, previous(new Date("2026-10-01T00:00:00Z"))];

    expect(
      verifyWebhookSignature({ rawBody: BODY, signature: sign("previous-secret"), secrets, now: NOW }),
    ).toEqual({ valid: true, matchedSecret: "PREVIOUS" });
  });

  it("accepts a previous secret with no expiry until it is removed", () => {
    expect(
      verifyWebhookSignature({
        rawBody: BODY,
        signature: sign("previous-secret"),
        secrets: [current, previous(null)],
        now: NOW,
      }),
    ).toEqual({ valid: true, matchedSecret: "PREVIOUS" });
  });

  it("rejects an expired previous secret", () => {
    const secrets = [current, previous(new Date("2026-09-25T11:59:59Z"))];

    expect(
      verifyWebhookSignature({ rawBody: BODY, signature: sign("previous-secret"), secrets, now: NOW }),
    ).toEqual({ valid: false });
  });

  it("treats the expiry instant itself as expired", () => {
    const secrets = [current, previous(NOW)];

    expect(
      verifyWebhookSignature({ rawBody: BODY, signature: sign("previous-secret"), secrets, now: NOW }),
    ).toEqual({ valid: false });
  });

  it("still accepts the current secret when the previous one has expired", () => {
    const secrets = [current, previous(new Date("2026-01-01T00:00:00Z"))];

    expect(
      verifyWebhookSignature({ rawBody: BODY, signature: sign("current-secret"), secrets, now: NOW }),
    ).toEqual({ valid: true, matchedSecret: "CURRENT" });
  });

  it("reports the first matching secret when both would verify", () => {
    const same: WebhookSecret[] = [current, { ...previous(null), secret: "current-secret" }];

    expect(
      verifyWebhookSignature({ rawBody: BODY, signature: sign("current-secret"), secrets: same, now: NOW }),
    ).toEqual({ valid: true, matchedSecret: "CURRENT" });
  });
});

describe("verifyCheckoutSignature", () => {
  const keySecret = "key-secret";
  const paymentId = "pay_ABC123";
  const serverSubscriptionId = "sub_SERVER_HELD";

  const signatureFor = (subscriptionId: string) =>
    createHmac("sha256", keySecret).update(`${paymentId}|${subscriptionId}`).digest("hex");

  it("accepts a signature over the payment id and the server-held subscription id", () => {
    expect(
      verifyCheckoutSignature({
        paymentId,
        providerSubscriptionId: serverSubscriptionId,
        signature: signatureFor(serverSubscriptionId),
        keySecret,
      }),
    ).toBe(true);
  });

  it("uses the server-held id: a signature over an id the browser echoed back is refused", () => {
    // The browser pairs a real payment with a different subscription. The
    // signature is valid for THAT id, but the server verifies against its own.
    expect(
      verifyCheckoutSignature({
        paymentId,
        providerSubscriptionId: serverSubscriptionId,
        signature: signatureFor("sub_SOMEONE_ELSES"),
        keySecret,
      }),
    ).toBe(false);
  });

  it("refuses a different payment id, a different key, and a missing signature", () => {
    const signature = signatureFor(serverSubscriptionId);
    const base = { paymentId, providerSubscriptionId: serverSubscriptionId, signature, keySecret };

    expect(verifyCheckoutSignature({ ...base, paymentId: "pay_OTHER" })).toBe(false);
    expect(verifyCheckoutSignature({ ...base, keySecret: "another-key" })).toBe(false);
    expect(verifyCheckoutSignature({ ...base, signature: null })).toBe(false);
    expect(verifyCheckoutSignature({ ...base, signature: "" })).toBe(false);
  });

  it("orders the message payment id first, then the subscription id", () => {
    const swapped = createHmac("sha256", keySecret).update(`${serverSubscriptionId}|${paymentId}`).digest("hex");

    expect(
      verifyCheckoutSignature({ paymentId, providerSubscriptionId: serverSubscriptionId, signature: swapped, keySecret }),
    ).toBe(false);
  });
});
