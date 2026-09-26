import { NextRequest } from "next/server";

import { BillingController } from "@/modules/billing/backend/controller";

/** `POST /api/v1/me/billing/promotions/redeem` — redeem a promotion code for the caller (free access; no provider involved). */
export async function POST(request: NextRequest) {
  return BillingController.redeemPromotion(request);
}
