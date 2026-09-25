import {
  Authorization,
  AuthorizationCode,
  AuthorizationEvaluator,
  type AuthorizationContext,
  type AuthorizationDecision,
  type StrictAuthorizationActor,
} from "@/authorization";
import {
  Capability,
  hasCapability,
  minimumPlanFor,
  PLAN_DISPLAY_NAME,
} from "@/lib/entitlements";

import type { McpRequestContext } from "../server/context/request-context";

/**
 * MCP access — may this user use Kizunia through MCP at all?
 *
 * The one subscription gate for MCP (SB-PL-01; Subscription Phase II). It runs
 * once, in `dispatch.ts`, after the actor is resolved and before any tool
 * runs — never inside a tool or use case. Every tool is therefore covered by
 * the same check, and no tool carries subscription logic of its own.
 *
 * It is not a scope and not a per-action authorizer:
 *
 * - `requireScope` (./authorize-mcp.ts) asks what this *client* was granted.
 * - The domain authorizers (`CompetitionAuthorizer`, …) ask what the *actor*
 *   may do to a resource.
 * - This asks whether the *actor's effective access* includes MCP. It is not a
 *   `PlatformAction` either, because the permission set is a static role map
 *   (IB-4).
 *
 * Tool calls are gated, not the OAuth connection: entitlement can change after
 * a token is issued, so it is re-read on every request and a downgrade takes
 * effect immediately with the user's tokens and consent left intact.
 *
 * Platform admins pass through `.platformOverride()` (IB-7). That is an
 * interactive bypass for the admin's own requests; it never grants MCP to
 * anyone else, and it is never reported as a plan.
 */
interface McpAccessContext extends AuthorizationContext {
  actor: StrictAuthorizationActor;

  /** Whether the actor's effective access includes the MCP capability. */
  hasMcpCapability: boolean;
}

export class McpAccess {
  static async evaluate(context: McpRequestContext): Promise<AuthorizationDecision> {
    const hasMcpCapability = await hasCapability(context.actor.id, Capability.MCP);

    return this.decide({ actor: context.actor, hasMcpCapability });
  }

  /**
   * @throws {ForbiddenError} `UPGRADE_REQUIRED` (or `ACCOUNT_BANNED`) when the
   *   actor may not use MCP. Dispatch reports it as a tool error.
   */
  static async require(context: McpRequestContext): Promise<void> {
    Authorization.assert(await this.evaluate(context));
  }

  /** The rule itself, separated from the read so it can be unit-tested. */
  static decide(context: McpAccessContext): AuthorizationDecision {
    return AuthorizationEvaluator
      .start(context)

      .security(
        (ctx) => !ctx.actor.banned,
        AuthorizationCode.ACCOUNT_BANNED,
        "Your account has been banned.",
      )

      .platformOverride()

      .require(
        (ctx) => ctx.hasMcpCapability,
        AuthorizationCode.UPGRADE_REQUIRED,
        `MCP access requires ${PLAN_DISPLAY_NAME[minimumPlanFor(Capability.MCP)]}.`,
      )

      .grant()

      .evaluate();
  }
}
