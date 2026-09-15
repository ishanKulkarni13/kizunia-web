import { NextRequest } from "next/server";
import { RecommendationController } from "@/modules/recommendations/backend/controller";

export async function POST(request: NextRequest) {
  return RecommendationController.generateForCurrentUser(request);
}
