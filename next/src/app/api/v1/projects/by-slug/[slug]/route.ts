import { ProjectController } from "@/modules/projects/backend/controller";
import { NextRequest } from "next/server";

export  const GET = async (
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) =>
  ProjectController.findBySlug(request, (await params).slug);