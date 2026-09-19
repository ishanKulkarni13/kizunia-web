import { NextRequest } from "next/server";

import { TechnologyController } from "@/modules/technologies/backend/controller";

export async function GET(request: NextRequest) {
    return TechnologyController.getCatalog(request);
}
