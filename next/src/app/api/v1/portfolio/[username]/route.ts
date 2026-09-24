import { NextRequest } from "next/server";

import { PortfolioController } from "@/modules/portfolio/backend/controller";

// The response carries a resume URL that is signed and short-lived (see
// `buildAssetViewUrl`). It must be minted per request and never served from a
// cache, so this route is never statically optimised.
export const dynamic = "force-dynamic";

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
