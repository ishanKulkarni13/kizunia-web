import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

/** `POST /api/v1/admin/billing/resync` — bulk re-sync: mark subscriptions due (MANAGE_BILLING). */
export async function POST(request: NextRequest) {
  return BillingAdminController.bulkResync(request);
}
