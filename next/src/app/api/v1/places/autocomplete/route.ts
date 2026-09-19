import { PlaceController } from "@/modules/locations/backend/place.controller";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return PlaceController.autocomplete(request);
}
