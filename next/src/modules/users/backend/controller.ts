/**
 * Users Module — Controller
 *
 * Request parsing, authentication, calling services, returning responses.
 * No business logic here. Unlike Competition/Project's setAsset, there is
 * no separate target-domain authorization step to delegate to: the target
 * is always the authenticated caller's own row, so authentication alone is
 * the authorization.
 */

import { NextRequest } from "next/server";

import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { SessionService } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import { SetAssetSchema } from "@/modules/assets/schemas/set-asset";

import { isUserAssetSlot } from "../types/asset-slot";
import { userService } from "./service";

export class UserController {
  static async setAsset(request: NextRequest, slot: string) {
    return Route.execute(async () => {
      // Validation (slot)
      if (!isUserAssetSlot(slot)) {
        throw new ValidationError({
          code: "INVALID_ASSET_SLOT",
          status: 400,
          message: `"${slot}" is not a valid user asset slot.`,
        });
      }

      // Authentication
      const actor = await SessionService.getStrictActor(request);

      // Validation (body)
      const { assetId } = SetAssetSchema.parse(await request.json());

      // Business Logic
      const asset = await userService.setAsset({ actor, slot, assetId });

      return ApiResponse.ok(asset);
    });
  }
}
