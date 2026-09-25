import { NextRequest } from "next/server";

import { BillingController } from "@/modules/billing/backend/controller";

/** A checkout may make one provider create; keep it inside the default function limit. */
export const maxDuration = 60;

/** `POST /api/v1/me/billing/checkout` — start (or resume) a paid checkout. */
export async function POST(request: NextRequest) {
  return BillingController.startCheckout(request);
}
