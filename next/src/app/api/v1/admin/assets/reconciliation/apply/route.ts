import { NextRequest } from "next/server";

import { AssetAdminController } from "@/modules/assets/backend/admin-controller";

export async function POST(request: NextRequest) {
  return AssetAdminController.applyReconciliation(request);
}
