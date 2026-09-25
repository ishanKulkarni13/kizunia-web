import { NextRequest } from "next/server";

import { BillingController } from "@/modules/billing/backend/controller";

/** `POST /api/v1/me/billing/checkout/confirm` — confirm a checkout after Razorpay Checkout. */
export async function POST(request: NextRequest) {
  return BillingController.confirmCheckout(request);
}
