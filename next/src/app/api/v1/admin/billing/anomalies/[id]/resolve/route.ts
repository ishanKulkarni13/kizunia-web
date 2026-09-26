import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** `POST /api/v1/admin/billing/anomalies/{id}/resolve` — resolve with a reason (MANAGE_BILLING). */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return BillingAdminController.resolveAnomaly(request, id);
}
