import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** `GET /api/v1/admin/billing/users/{id}/timeline` — the user's billing timeline (VIEW_BILLING). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return BillingAdminController.userTimeline(request, id);
}
