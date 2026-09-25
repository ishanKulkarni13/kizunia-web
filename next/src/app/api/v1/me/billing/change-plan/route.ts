import { NextRequest } from "next/server";

import { BillingController } from "@/modules/billing/backend/controller";

/** A plan change may clear a scheduled change, update, and confirm: keep it inside the function limit. */
export const maxDuration = 60;

/** `POST /api/v1/me/billing/change-plan` — a native plan change, where Razorpay allows one. */
export async function POST(request: NextRequest) {
  return BillingController.changePlan(request);
}
