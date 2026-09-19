import { ProjectController } from "@/modules/projects/backend/controller";
import { NextRequest } from "next/server";

export const GET = (request: NextRequest) =>
  ProjectController.findMine(request);
