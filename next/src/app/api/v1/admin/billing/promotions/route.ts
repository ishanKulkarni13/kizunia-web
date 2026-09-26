import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

/** `GET /api/v1/admin/billing/promotions` — list promotions (`MANAGE_ENTITLEMENT_GRANTS`). */
export async function GET(request: NextRequest) {
  return BillingAdminController.listPromotions(request);
}

/** `POST /api/v1/admin/billing/promotions` — create a promotion (`MANAGE_ENTITLEMENT_GRANTS`). */
export async function POST(request: NextRequest) {
  return BillingAdminController.createPromotion(request);
}
