import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** `GET /api/v1/admin/billing/events/{id}/payload` — one webhook's raw payload (SUPER_ADMIN only). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return BillingAdminController.rawPayload(request, id);
}
