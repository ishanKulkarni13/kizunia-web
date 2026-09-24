import { NextRequest } from "next/server";

import { BillingController } from "@/modules/billing/backend/controller";

export async function GET(request: NextRequest) {
  return BillingController.getMyEntitlements(request);
}
