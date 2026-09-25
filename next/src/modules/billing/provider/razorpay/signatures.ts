/**
 * Razorpay — Signatures
 *
 * The two HMAC-SHA256 checks Kizunia performs, both compared in constant time
 * with the repository's `secretEquals` and never with `===`.
 *
 * **Webhook** (`X-Razorpay-Signature`): HMAC-SHA256 over the **raw**, unparsed
 * request body, keyed with the webhook secret, a different secret from the API
 * key. It is verified before the body is parsed, before any write and before
 * any business logic (SB-WH-01). Razorpay signs retries of events created
 * before a secret rotation with the OLD secret, so a previous secret is also
 * accepted, but only inside its bounded window (SB-WH-07). Which secret
 * matched is returned, so the end of a rotation is observable.
 *
 * **Checkout**: HMAC-SHA256 of `paymentId|providerSubscriptionId`, keyed with
 * the API key secret. The subscription id must be the one the *server* holds,
 * never the value the browser echoed back: verifying against the echoed id
 * would let a customer pair a real payment with someone else's subscription
 * (SB-CM-06). A failure here only logs; synchronization still decides.
 *
 * Nothing in this file logs or returns a secret or a computed signature.
 */
import { createHmac } from "node:crypto";

import { secretEquals } from "@/lib/security/timing-safe-equal";

import type { WebhookSignatureMatch } from "../types";

export interface WebhookSecret {
  readonly secret: string;
  readonly label: "CURRENT" | "PREVIOUS";
  /** When this secret stops being accepted. `null` = it is not time-limited. */
  readonly validUntil: Date | null;
}

export function hmacSha256Hex(secret: string, payload: string | Uint8Array): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** A supplied signature, normalized for comparison; `null` when there is none to compare. */
function normalizeSignature(signature: string | null | undefined): string | null {
  const trimmed = signature?.trim().toLowerCase();

  return trimmed ? trimmed : null;
}

/**
 * Verifies a webhook signature against each acceptable secret.
 *
 * Fails closed: no signature, or no secret, verifies nothing. Every
 * acceptable secret is checked, so how long the check takes does not depend on
 * which one matched.
 */
export function verifyWebhookSignature(input: {
  readonly rawBody: string | Uint8Array;
  readonly signature: string | null | undefined;
  readonly secrets: readonly WebhookSecret[];
  readonly now: Date;
}): WebhookSignatureMatch {
  const supplied = normalizeSignature(input.signature);

  if (supplied === null) return { valid: false };

  let matched: WebhookSecret["label"] | null = null;

  for (const candidate of input.secrets) {
    const expired =
      candidate.validUntil !== null && input.now.getTime() >= candidate.validUntil.getTime();

    if (expired) continue;

    const expected = hmacSha256Hex(candidate.secret, input.rawBody);

    if (secretEquals(supplied, expected) && matched === null) matched = candidate.label;
  }

  return matched === null ? { valid: false } : { valid: true, matchedSecret: matched };
}

/**
 * Verifies a checkout signature. `providerSubscriptionId` MUST be the id held
 * by the server for this checkout.
 */
export function verifyCheckoutSignature(input: {
  readonly paymentId: string;
  readonly providerSubscriptionId: string;
  readonly signature: string | null | undefined;
  readonly keySecret: string;
}): boolean {
  const supplied = normalizeSignature(input.signature);

  if (supplied === null) return false;

  const expected = hmacSha256Hex(input.keySecret, `${input.paymentId}|${input.providerSubscriptionId}`);

  return secretEquals(supplied, expected);
}
