import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

/** `GET /api/v1/admin/billing/users?userId=|email=` — finds a user for the billing views (VIEW_BILLING). */
export async function GET(request: NextRequest) {
  return BillingAdminController.lookupUser(request);
}
