import type {
  AuthorizationActor,
  AuthorizationContext,
} from "@/authorization";


import type {
  ProjectAuthorizationEntity,
} from "../repository";
import { ProjectRole } from "@/generated/prisma";

/**
 * Complete authorization context for a Project.
 *
 * This object contains everything required to make an
 * authorization decision.
 *
 * Once constructed, no additional database queries should
 * be required by the authorization system.
 */
export interface ProjectContext
  extends AuthorizationContext {
  /**
   * The authenticated actor performing the action.
   */
  actor: AuthorizationActor;

  /**
   * The target project.
   *
   * This is the minimal authorization entity required
   * by the policy.
   */
  project: ProjectAuthorizationEntity;

  /**
   * The actor's membership within the project.
   *
   * Null if the actor is not a member.
   */
  membership: {
    role: ProjectRole;
  } | null;
}
/**
 * Authorization context for creating a project the actor will own.
 *
 * Built inside `ProjectService.create`'s transaction, after the per-user
 * advisory lock, so `owned` cannot change before the project is written.
 * `limit` comes from the actor's effective access (`lib/entitlements`); this
 * module never knows which plan produced it.
 */
export interface ProjectOwnershipQuotaContext
  extends AuthorizationContext {
  actor: AuthorizationActor;

  /** Non-deleted projects the actor owns now. */
  owned: number;

  /** The owned-project quota of the actor's effective access. */
  limit: number;
}
