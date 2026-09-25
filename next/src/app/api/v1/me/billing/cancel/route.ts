import { NextRequest } from "next/server";

import { BillingController } from "@/modules/billing/backend/controller";

/** A cancel may make one provider call plus a scheduled-change clear and confirming fetches. */
export const maxDuration = 60;

/** `POST /api/v1/me/billing/cancel` — cancel the caller's subscription with the timing they confirmed. */
export async function POST(request: NextRequest) {
  return BillingController.cancel(request);
}
