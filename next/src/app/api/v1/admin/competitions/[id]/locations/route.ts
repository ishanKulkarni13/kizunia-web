import { CompetitionController } from "@/modules/competitions/backend/controller";
import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const { id } = await params;

  return CompetitionController.listLocations(request, id);
}

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const { id } = await params;

  return CompetitionController.addLocation(request, id);
}

/**
 * Reorders the competition's locations.
 *
 * Lives on the collection rather than an individual location because ordering
 * is a property of the list — a single location cannot meaningfully change its
 * own position without moving the others.
 */
export async function PATCH(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  const { id } = await params;

  return CompetitionController.reorderLocations(request, id);
}
