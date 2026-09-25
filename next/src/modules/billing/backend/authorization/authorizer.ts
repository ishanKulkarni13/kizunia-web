import { Authorization } from "@/authorization/assert";
import { PlatformAction } from "@/authorization/platform/actions";
import type { PlatformContext } from "@/authorization/platform/context";
import { PlatformPolicy } from "@/authorization/platform/policy";

/**
 * Billing — Authorization
 *
 * Billing admin surfaces use explicit platform actions (IB-15, product
 * decision): SUPER_ADMIN manages grants and billing; ADMIN views billing;
 * MODERATOR and USER hold neither.
 *
 * Deliberately no `platformOverride()`: the platform-role bypass never confers
 * a billing action implicitly, so it can never become a way to give paid access
 * without an audit trail (docs/architecture/subscription/cross-cutting/security.md).
 */
export class BillingAuthorizer {
  /** Create, extend or revoke an entitlement grant. */
  static manageGrants(context: PlatformContext): void {
    Authorization.assert(
      PlatformPolicy.can(context, PlatformAction.MANAGE_ENTITLEMENT_GRANTS),
    );
  }

  /** Read billing state (grants, in Phase I). */
  static viewBilling(context: PlatformContext): void {
    Authorization.assert(PlatformPolicy.can(context, PlatformAction.VIEW_BILLING));
  }

  /** Whether the actor may manage grants — for server-computed UI flags only. */
  static canManageGrants(context: PlatformContext): boolean {
    return PlatformPolicy.can(context, PlatformAction.MANAGE_ENTITLEMENT_GRANTS).allowed;
  }
}
