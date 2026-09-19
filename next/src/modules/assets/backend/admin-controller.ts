/**
 * Assets Module - Admin Controller
 *
 * Responsible for:
 * - Request parsing
 * - Authentication checks
 * - Calling the admin service
 * - Returning responses
 *
 * Authorization (MANAGE_MEDIA) is NOT checked here — it lives in
 * `AssetAdminService`, exactly like `TechnologyController`/`TechnologyService`.
 * Controllers in this repo never contain business logic.
 */

import { NextRequest, NextResponse } from "next/server";

import { SessionService } from "@/lib/auth/index";
import { ApiResponse } from "@/lib/http";

import { Route } from "@/lib/http/route";

import { assetAdminService } from "./admin.service";
import {
  ApplyAssetReconciliationSchema,
} from "../schemas/apply-asset-reconciliation";

export class AssetAdminController {
  static async list(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const query = Object.fromEntries(request.nextUrl.searchParams.entries());

      const result = await assetAdminService.search(actor, query);

      return ApiResponse.ok(result);
    });
  }

  static async detail(request: NextRequest, assetId: string) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const asset = await assetAdminService.getById(actor, assetId);

      return ApiResponse.ok(asset);
    });
  }

  /**
   * Explicitly HTTP 302 — `NextResponse.redirect(url)` defaults to 307, and
   * `redirect()` from `next/navigation` is a framework control-flow
   * mechanism (throws), not an HTTP response. Neither is used. The URL is
   * minted fresh on every call (see `AssetAdminService.getDownloadTarget`)
   * and never cached by this response.
   */
  static async download(request: NextRequest, assetId: string) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const { url } = await assetAdminService.getDownloadTarget(actor, assetId);

      return NextResponse.redirect(url, {
        status: 302,
        headers: { "Cache-Control": "no-store" },
      });
    });
  }

  static async previewReconciliation(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const query = Object.fromEntries(request.nextUrl.searchParams.entries());

      const preview = await assetAdminService.previewReconciliation(actor, query);

      return ApiResponse.ok(preview);
    });
  }

  static async applyReconciliation(request: NextRequest) {
    return Route.execute(async () => {
      const actor = await SessionService.getStrictActor(request);

      const body = await request.json();

      const { ids } = ApplyAssetReconciliationSchema.parse(body);

      const result = await assetAdminService.applyReconciliation(actor, ids);

      return ApiResponse.ok(result);
    });
  }
}
