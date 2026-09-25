import { describe, expect, it } from "vitest";

import { dynamic, maxDuration, runtime } from "./route";

describe("POST /api/v1/webhooks/razorpay — route configuration", () => {
  it("runs on Node (raw bytes, node:crypto HMAC) and is never statically evaluated", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBeLessThanOrEqual(60);
  });
});
