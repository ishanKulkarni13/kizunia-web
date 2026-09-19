import { LocationController } from "@/modules/locations/backend/controller";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return LocationController.autocomplete(request);
}
