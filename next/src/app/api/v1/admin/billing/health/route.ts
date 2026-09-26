import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

/** `GET /api/v1/admin/billing/health` — the table-derived billing health summary (VIEW_BILLING). */
export async function GET(request: NextRequest) {
  return BillingAdminController.healthSummary(request);
}
