import { Authorization } from "@/authorization";
import { PlatformAction } from "@/authorization/platform/actions";
import type { PlatformContext } from "@/authorization/platform/context";
import { PlatformPolicy } from "@/authorization/platform/policy";

/**
 * Asset is a global, cross-domain resource with no per-instance ownership
 * (an Asset may be shared across Users/Projects/Competitions/etc. — see
 * docs/architecture/domain/assets/overview.md) — there is no resource-scoped
 * context, policy or permission set to build here. Every admin operation
 * (list/detail/download/reconciliation preview/apply) gates on the same
 * platform capability, `MANAGE_MEDIA`, so this is a thin, single-method
 * wrapper around `PlatformAuthorizer.can`, kept as its own class only to
 * match this module's `XxxAuthorizer.method(context)` convention (see
 * `TechnologyAuthorizer`) rather than sprinkling `PlatformPolicy.can` calls
 * directly through the admin service.
 */
export class AssetAuthorizer {
  static manage(context: PlatformContext): void {
    Authorization.assert(
      PlatformPolicy.can(context, PlatformAction.MANAGE_MEDIA),
    );
  }
}
