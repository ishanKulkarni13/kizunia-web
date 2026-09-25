import { NextRequest } from "next/server";

import { BillingController } from "@/modules/billing/backend/controller";

/** `POST /api/v1/me/billing/sync` — "check now": re-read the caller's subscription from Razorpay. */
export async function POST(request: NextRequest) {
  return BillingController.checkNow(request);
}
