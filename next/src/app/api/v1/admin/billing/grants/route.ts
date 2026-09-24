import { NextRequest } from "next/server";

import { BillingAdminController } from "@/modules/billing/backend/admin.controller";

export async function GET(request: NextRequest) {
  return BillingAdminController.listGrants(request);
}

export async function POST(request: NextRequest) {
  return BillingAdminController.createGrant(request);
}
