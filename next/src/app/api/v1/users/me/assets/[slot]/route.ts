import { UserController } from "@/modules/users/backend/controller";
import { NextRequest } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ slot: string }> },
) {
  const { slot } = await params;

  // Slot is validated inside UserController.setAsset. There is no [id]
  // segment — this always acts on the authenticated caller's own row.
  return UserController.setAsset(request, slot);
}
