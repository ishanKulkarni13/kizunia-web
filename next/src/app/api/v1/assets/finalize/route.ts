import { NextRequest } from "next/server";

import { AssetController } from "@/modules/assets/backend/controller";

export async function POST(request: NextRequest) {
  return AssetController.finalize(request);
}
