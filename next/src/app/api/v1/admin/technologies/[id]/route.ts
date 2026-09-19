import { NextRequest } from "next/server";

import { TechnologyController } from "@/modules/technologies/backend/controller";

interface RouteParams {
    params: Promise<{
        id: string;
    }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    return TechnologyController.findById(request, id);
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    return TechnologyController.updateFields(request, id);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    return TechnologyController.delete(request, id);
}
