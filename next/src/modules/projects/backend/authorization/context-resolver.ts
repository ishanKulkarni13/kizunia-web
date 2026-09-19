import type { AuthorizationActor } from "@/authorization";

import {
  ProjectAuthorizationEntity,
  ProjectRepository,
} from "../repository";

import type { ProjectContext } from "./context";
import { ProjectNotFoundError } from "../errors/index";

export class ProjectContextResolver {
  /**
   * Resolves the authorization context using a project id.
   */
  static async resolve({
    actor,
    projectId,
  }: {
    actor: AuthorizationActor;
    projectId: string;
  }): Promise<ProjectContext> {
    const repository = new ProjectRepository();

    const [project, membership] = await Promise.all([
      repository.findForAuthorization({
        id: projectId,
      }),

      actor.id
        ? repository.findMembership({
            projectId,
            userId: actor.id,
          })
        : Promise.resolve(null),
    ]);

    if (!project) {
      throw new ProjectNotFoundError();
    }

    return this.fromData({
      actor,

      project,

      membership,
    });
  }

  /**
   * Resolves the authorization context using a project slug.
   */
  static async resolveBySlug({
    actor,
    slug,
  }: {
    actor: AuthorizationActor;
    slug: string;
  }): Promise<ProjectContext> {
    const repository = new ProjectRepository();

    const project = await repository.findBySlug({
      slug,
    });

    if (!project) {
      throw new ProjectNotFoundError();
    }

    const membership = actor.id
      ? await repository.findMembership({
          projectId: project.id,
          userId: actor.id,
        })
      : null;

    return this.fromData({
      actor,

      project,

      membership,
    });
  }

  /**
   * Creates a context from already loaded entities.
   *
   * Use this whenever the caller already has the project and/or membership.
   * This avoids unnecessary database queries.
   */
  static fromData({
    actor,
    project,
    membership,
  }: ProjectContext): ProjectContext {
    return {
      actor: {
        id: actor.id,
        role: actor.role,
        banned: actor.banned,
      },

      project,

      membership,
    };
  }
}