/**
 * The integration suite must never reach the real payment provider, even when
 * the developer's `.env` holds real Razorpay TEST credentials (see
 * `integration-env.ts`). This pins that: after every import that reloads
 * `.env` (Prisma's included), the provider mode still resolves to DISABLED.
 */
import { describe, expect, it } from "vitest";

import "@/lib/prisma";
import { getProviderMode, resolveProviderConfiguration } from "@/modules/billing/provider/provider-mode";

describe("integration tests and the payment provider", () => {
  it("see no Razorpay credentials, so billing resolves to DISABLED", () => {
    for (const [name, value] of Object.entries(process.env)) {
      if (name.startsWith("RAZORPAY_")) expect(value, name).toBe("");
    }

    expect(resolveProviderConfiguration().mode).toBe("DISABLED");
    expect(getProviderMode()).toBe("DISABLED");
  });
});
