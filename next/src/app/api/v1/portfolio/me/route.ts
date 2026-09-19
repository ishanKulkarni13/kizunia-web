import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

export async function GET(request: NextRequest) {
  return PortfolioController.findMine(request);
}