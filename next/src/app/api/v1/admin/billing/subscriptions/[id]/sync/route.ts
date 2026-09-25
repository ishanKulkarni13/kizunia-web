import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** `POST /api/v1/admin/billing/subscriptions/{id}/sync` — admin "sync now" (VIEW_BILLING). */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return BillingAdminController.syncSubscription(request, id);
}
