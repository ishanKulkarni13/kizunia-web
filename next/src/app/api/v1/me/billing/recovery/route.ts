import { NextRequest } from "next/server";

import { BillingController } from "@/modules/billing/backend/controller";

/** `POST /api/v1/me/billing/recovery` — open Razorpay's payment-method change for an on-hold subscription. */
export async function POST(request: NextRequest) {
  return BillingController.recovery(request);
}
