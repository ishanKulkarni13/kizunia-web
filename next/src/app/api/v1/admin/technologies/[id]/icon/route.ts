import { NextRequest } from "next/server";

import { TechnologyController } from "@/modules/technologies/backend/controller";

interface RouteParams {
    params: Promise<{
        id: string;
    }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    return TechnologyController.setIcon(request, id);
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const { id } = await params;

    return TechnologyController.clearIcon(request, id);
}
