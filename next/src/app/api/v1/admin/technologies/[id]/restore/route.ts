import { NextRequest } from "next/server";

import { TechnologyController } from "@/modules/technologies/backend/controller";

interface RouteParams {
    params: Promise<{
        id: string;
    }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    return TechnologyController.restore(request, id);
}
