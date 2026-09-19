import { NextRequest } from "next/server";

import { AssetAdminController } from "@/modules/assets/backend/admin-controller";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  return AssetAdminController.detail(request, id);
}
