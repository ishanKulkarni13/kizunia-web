import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      username: string;
    }>;
  },
) {
  const { username } = await params;

  return PortfolioController.findPublicByUsername(request, username);
}
