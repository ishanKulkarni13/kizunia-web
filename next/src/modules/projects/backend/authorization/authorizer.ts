import { Authorization } from "@/authorization";

import { ProjectAction } from "./actions";
import type { ProjectContext } from "./context";
import { ProjectPolicy } from "./policy";

import { PlatformAction } from "@/authorization/platform/actions";
import type { PlatformContext } from "@/authorization/platform/context";
import { PlatformPolicy } from "@/authorization/platform/policy";

export class ProjectAuthorizer {
  static read(
    context: ProjectContext,
  ): void {
    Authorization.assert(
      ProjectPolicy.can(
        context,
        ProjectAction.VIEW,
      ),
    );
  }

  static create(
    context: PlatformContext,
  ): void {
    Authorization.assert(
      PlatformPolicy.can(
        context,
        PlatformAction.CREATE_PROJECT,
      ),
    );
  }

  static edit(
    context: ProjectContext,
  ): void {
    Authorization.assert(
      ProjectPolicy.can(
        context,
        ProjectAction.EDIT,
      ),
    );
  }

  static delete(
    context: ProjectContext,
  ): void {
    Authorization.assert(
      ProjectPolicy.can(
        context,
        ProjectAction.DELETE,
      ),
    );
  }

  static manageContent(
    context: ProjectContext,
  ): void {
    Authorization.assert(
      ProjectPolicy.can(
        context,
        ProjectAction.MANAGE_CONTENT,
      ),
    );
  }

  static can(
    context: ProjectContext,
    action: ProjectAction,
  ): void {
    Authorization.assert(
      ProjectPolicy.can(
        context,
        action,
      ),
    );
  }
}