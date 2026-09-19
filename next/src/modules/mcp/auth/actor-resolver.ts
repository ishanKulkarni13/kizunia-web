import { PlatformContextResolver } from "@/authorization/platform/resolver";
import type { StrictAuthorizationActor } from "@/authorization";

import { McpUnauthorizedError } from "../errors/mcp-error";
import type { McpPrincipal } from "./authentication";

/**
 * Resolves an authenticated MCP principal into a Kizunia authorization
 * actor.
 *
 * =============================================================================
 * Why the token's claims are not used
 * =============================================================================
 *
 * The token carries a `userId` and nothing else this layer trusts. Role and
 * ban state are read fresh from the database on every call, through the
 * *same* `PlatformContextResolver` every other Kizunia surface uses.
 *
 * That matters because an access token outlives the facts it was minted
 * from. A user demoted from SUPER_ADMIN, or banned, an hour after consenting
 * still holds a valid, unexpired token. If MCP trusted a cached role, that
 * token would keep exercising authority the user no longer has until it
 * expired — a privilege-escalation window measured in hours. Re-reading
 * makes a demotion or a ban take effect on the very next tool call.
 *
 * This is also why no `McpActor` type exists: the resolver returns Kizunia's
 * own `StrictAuthorizationActor`, so from here inward nothing can tell (or
 * needs to tell) that the caller arrived over MCP. That is what lets the
 * authorization layer and the domain stay entirely MCP-unaware.
 */
export class McpActorResolver {
  /**
   * @throws {McpUnauthorizedError} when the token's subject no longer
   *   resolves to a usable Kizunia account.
   */
  static async resolve(principal: McpPrincipal): Promise<StrictAuthorizationActor> {
    let context;

    try {
      context = await PlatformContextResolver.resolve({
        id: principal.userId,
        role: null,
        banned: null,
      });
    } catch {
      // The resolver throws `UserNotFoundError` when the row is gone — a
      // deleted account whose token has not yet expired. Deliberately
      // reported as an authentication failure rather than forwarded: a
      // "user not found" that names the subject would let a client
      // distinguish a deleted account from a wrong one, and there is no
      // action the client can take either way except re-authenticate.
      throw new McpUnauthorizedError(
        "The Kizunia account behind this access token is no longer available.",
      );
    }

    const { actor } = context;

    if (!actor.id) {
      throw new McpUnauthorizedError(
        "The Kizunia account behind this access token could not be resolved.",
      );
    }

    // Normalised to the strict shape the policies expect. `banned` is *not*
    // rejected here on purpose: banning is an authorization concern, and
    // `PlatformPolicy`/`CompetitionPolicy` already deny a banned actor with
    // a specific `ACCOUNT_BANNED` code. Short-circuiting it here as an
    // authentication failure would produce a less accurate error and create
    // a second place where ban handling lives.
    return {
      id: actor.id,
      role: actor.role ?? "",
      banned: actor.banned === true,
    };
  }
}
