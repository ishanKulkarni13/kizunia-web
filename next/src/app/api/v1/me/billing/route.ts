import { NextRequest } from "next/server";

import { BillingController } from "@/modules/billing/backend/controller";

/** `GET /api/v1/me/billing` — the caller's billing summary. */
export async function GET(request: NextRequest) {
  return BillingController.getMyBilling(request);
}
