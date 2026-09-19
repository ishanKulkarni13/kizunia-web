import { ProjectController } from "@/modules/projects/backend/controller";
import { NextRequest } from "next/server";

export const GET = (request: NextRequest) =>
  ProjectController.findMany({request});

export const POST = (request: NextRequest) =>
  ProjectController.create(request);