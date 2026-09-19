import { TaxonomyController } from "@/modules/taxonomy";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return TaxonomyController.technologies(request);
}
