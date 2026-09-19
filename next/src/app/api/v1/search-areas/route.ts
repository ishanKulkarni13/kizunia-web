import { SearchAreaController } from "@/modules/locations/backend/search-area.controller";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return SearchAreaController.search(request);
}
