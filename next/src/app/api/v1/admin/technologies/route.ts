import { NextRequest } from "next/server";

import { TechnologyController } from "@/modules/technologies/backend/controller";

export async function GET(request: NextRequest) {
    return TechnologyController.search(request);
}

export async function POST(request: NextRequest) {
    return TechnologyController.create(request);
}
