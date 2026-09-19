import { NextRequest } from "next/server";

import { AssetAdminController } from "@/modules/assets/backend/admin-controller";

export async function GET(request: NextRequest) {
  return AssetAdminController.previewReconciliation(request);
}
