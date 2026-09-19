import { PortfolioController } from "@/modules/portfolio/backend/controller";
import { NextRequest } from "next/server";


export async function POST(
  request: NextRequest,
) {
  return PortfolioController.create(request);
}