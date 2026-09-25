import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

/** One provider cancel and a confirming fetch. */
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** `POST /api/v1/admin/billing/subscriptions/{id}/cancel` — admin immediate cancel with a reason (MANAGE_BILLING). */
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;

  return BillingAdminController.cancelSubscription(request, id);
}
