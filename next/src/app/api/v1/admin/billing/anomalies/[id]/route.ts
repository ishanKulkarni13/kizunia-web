import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** `GET /api/v1/admin/billing/anomalies/{id}` — anomaly detail (VIEW_BILLING). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return BillingAdminController.getAnomaly(request, id);
}
