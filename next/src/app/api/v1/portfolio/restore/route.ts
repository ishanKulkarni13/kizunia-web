import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

export async function POST(request: NextRequest) {
  return PortfolioController.restore(request);
}
