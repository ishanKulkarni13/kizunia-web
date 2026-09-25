import { describe, expect, it } from "vitest";

import { DisabledBillingProvider } from "./disabled-provider";

describe("DisabledBillingProvider — the webhook fails closed", () => {
  it("verifies nothing, and reads nothing", () => {
    const provider = new DisabledBillingProvider();

    expect(provider.verifyWebhookSignature()).toEqual({ valid: false });
    expect(provider.parseWebhookEvent()).toEqual({ kind: "MALFORMED", reason: "billing is disabled" });
  });
});
