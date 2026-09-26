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

  /**
   * A billing write other than a grant: an immediate cancel at the provider
   * (Phase VI), resolving an anomaly or a bulk re-sync (Phase VIII).
   * SUPER_ADMIN only (IB-15).
   */
  static manageBilling(context: PlatformContext): void {
    Authorization.assert(PlatformPolicy.can(context, PlatformAction.MANAGE_BILLING));
  }

  /** Read billing state: grants, explain, timeline, anomalies, health, and "sync now". */
  static viewBilling(context: PlatformContext): void {
    Authorization.assert(PlatformPolicy.can(context, PlatformAction.VIEW_BILLING));
  }

  /**
   * Read a webhook's raw provider payload, which may carry customer contact
   * details. SUPER_ADMIN only (IB-15, IB-28); `viewBilling` does not imply it.
   */
  static viewRawPayloads(context: PlatformContext): void {
    Authorization.assert(PlatformPolicy.can(context, PlatformAction.VIEW_BILLING_RAW_PAYLOADS));
  }

  /** Whether the actor may manage grants — for server-computed UI flags only. */
  static canManageGrants(context: PlatformContext): boolean {
    return PlatformPolicy.can(context, PlatformAction.MANAGE_ENTITLEMENT_GRANTS).allowed;
  }

  /** Whether the actor may make billing writes — for server-computed UI flags only. */
  static canManageBilling(context: PlatformContext): boolean {
    return PlatformPolicy.can(context, PlatformAction.MANAGE_BILLING).allowed;
  }

  /** Whether the actor may read raw payloads — for server-computed UI flags only. */
  static canViewRawPayloads(context: PlatformContext): boolean {
    return PlatformPolicy.can(context, PlatformAction.VIEW_BILLING_RAW_PAYLOADS).allowed;
  }
}
