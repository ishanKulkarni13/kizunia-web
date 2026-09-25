/**
 * Billing — "My entitlements"
 *
 * The signed-in user's effective access, as server-computed flags for the UI.
 * The UI renders these and never computes access, quotas or plan rules itself.
 *
 * A thin mapping over `lib/entitlements`: every rule lives there.
 */
import type { StrictAuthorizationActor } from "@/authorization";
import { Capability, Quota, resolveEffectiveAccess, type EffectivePlan } from "@/lib/entitlements";

export interface MyEntitlementsDTO {
  readonly plan: EffectivePlan;
  readonly capabilities: {
    readonly portfolio: boolean;
    readonly deadlineNotifications: boolean;
    readonly recommendations: boolean;
    readonly mcp: boolean;
  };
  readonly quotas: {
    readonly ownedProjects: number;
  };
}

export class EntitlementsService {
  static async getForUser(actor: StrictAuthorizationActor): Promise<MyEntitlementsDTO> {
    const access = await resolveEffectiveAccess(actor.id);

    return {
      plan: access.plan,
      capabilities: {
        portfolio: access.capabilities[Capability.PORTFOLIO],
        deadlineNotifications: access.capabilities[Capability.DEADLINE_NOTIFICATIONS],
        recommendations: access.capabilities[Capability.RECOMMENDATIONS],
        mcp: access.capabilities[Capability.MCP],
      },
      quotas: {
        ownedProjects: access.quotas[Quota.OWNED_PROJECTS],
      },
    };
  }
}
