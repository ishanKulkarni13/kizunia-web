import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

export async function PATCH(request: NextRequest) {
  return PortfolioController.updateProfile(request);
}