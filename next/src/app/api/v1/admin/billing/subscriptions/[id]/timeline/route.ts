import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** `GET /api/v1/admin/billing/subscriptions/{id}/timeline` — one subscription's timeline (VIEW_BILLING). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return BillingAdminController.subscriptionTimeline(request, id);
}
