/**
 * Assets Module - Controller
 *
 * Request parsing, authentication, calling services, returning responses.
 * No business logic or authorization here — that lives in
 * UploadIntentService / target-authorization.ts.
 */

import { NextRequest } from "next/server";

import { ApiResponse } from "@/lib/http";
import { Route } from "@/lib/http/route";
import { SessionService } from "@/lib/auth/session";
import { RateLimitPolicyId } from "@/lib/rate-limit/policies";
import { rateLimitService } from "@/lib/rate-limit/service";

import { CreateUploadIntentSchema } from "../schemas/create-upload-intent";
import { FinalizeUploadSchema } from "../schemas/finalize-upload";
import { uploadIntentService } from "./upload-intent.service";

export class AssetController {
  static async createUploadIntent(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------
      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------
      const body = await request.json();

      const data = CreateUploadIntentSchema.parse(body);

      // -----------------------------------------------------------------
      // Rate Limiting
      // -----------------------------------------------------------------
      // Scoped per actor AND per purpose (a composite subject id) — an
      // actor's avatar-upload budget must not be consumed by, or starve,
      // their competition-gallery budget. Runs after parsing (purpose comes
      // from the body) but before the service's authorization/policy
      // checks, which is the expensive part this bounds.
      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.ASSETS_UPLOAD_INTENT,
        request,
        actor: { id: `${actor.id}:${data.purpose}` },
      });

      // -----------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------
      const result = await uploadIntentService.create({
        actor,
        purpose: data.purpose,
        targetEntityType: data.targetEntityType,
        targetEntityId: data.targetEntityId,
        declaredMimeType: data.declaredMimeType,
        declaredSize: data.declaredSize,
      });

      // -----------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------
      return ApiResponse.created(result);
    });
  }

  static async finalize(request: NextRequest) {
    return Route.execute(async () => {
      // -----------------------------------------------------------------
      // Authentication
      // -----------------------------------------------------------------
      const actor = await SessionService.getStrictActor(request);

      // -----------------------------------------------------------------
      // Rate Limiting
      // -----------------------------------------------------------------
      await rateLimitService.enforce({
        policyId: RateLimitPolicyId.ASSETS_FINALIZE,
        request,
        actor,
      });

      // -----------------------------------------------------------------
      // Validation
      // -----------------------------------------------------------------
      const body = await request.json();

      const data = FinalizeUploadSchema.parse(body);

      // -----------------------------------------------------------------
      // Business Logic
      // -----------------------------------------------------------------
      const asset = await uploadIntentService.finalize({
        actor,
        intentId: data.intentId,
      });

      // -----------------------------------------------------------------
      // Response
      // -----------------------------------------------------------------
      return ApiResponse.created(asset);
    });
  }
}
