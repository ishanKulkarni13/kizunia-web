import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** `GET /api/v1/admin/billing/users/{id}/access` — explain effective access (VIEW_BILLING). */
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return BillingAdminController.explainUser(request, id);
}
