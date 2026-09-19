import type {
    Competition,
    CompetitionMember,
    
} from "@/generated/prisma";
import type { AuthorizationActor, AuthorizationContext } from "@/authorization";
/**
 * Complete authorization context for a Competition.
 *
 * This object contains everything required to make an
 * authorization decision.
 *
 * Once constructed, no additional database queries should
 * be required by the authorization system.
 */
export interface CompetitionContext
    extends AuthorizationContext {
    /**
     * The authenticated user performing the action.
     */
    actor: AuthorizationActor;

    /**
     * The target competition.
     */
    competition: Competition;

    /**
     * The actor's membership within the competition.
     *
     * Null if the actor is not a member.
     */
    membership: CompetitionMember | null;
}