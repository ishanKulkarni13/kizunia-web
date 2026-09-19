import { Authorization } from "@/authorization";

import { CompetitionAction } from "./actions";
import type { CompetitionContext } from "./context";
import { CompetitionPolicy } from "./policy";

import { PlatformAction } from "@/authorization/platform/actions";
import type { PlatformContext } from "@/authorization/platform/context";
import { PlatformPolicy } from "@/authorization/platform/policy";

export class CompetitionAuthorizer {

    static read(
        context: CompetitionContext,
    ): void {
        Authorization.assert(
            CompetitionPolicy.can(
                context,
                CompetitionAction.VIEW,
            ),
        );
    }
    
    static create(
        context: PlatformContext,
    ): void {
        Authorization.assert(
            PlatformPolicy.can(
                context,
                PlatformAction.CREATE_COMPETITION,
            ),
        );
    }

    static edit(
        context: CompetitionContext,
    ): void {
        Authorization.assert(
            CompetitionPolicy.can(
                context,
                CompetitionAction.EDIT,
            ),
        );
    }

    static delete(
        context: CompetitionContext,
    ): void {
        Authorization.assert(
            CompetitionPolicy.can(
                context,
                CompetitionAction.DELETE,
            ),
        );
    }

    /**
     * Reverses a soft delete. See the note on `CompetitionAction.RESTORE` —
     * this is admin-only by construction, not by a check written here.
     */
    static restore(
        context: CompetitionContext,
    ): void {
        Authorization.assert(
            CompetitionPolicy.can(
                context,
                CompetitionAction.RESTORE,
            ),
        );
    }


    static manageTechnologies(
        context: CompetitionContext,
    ): void {
        Authorization.assert(
            CompetitionPolicy.can(
                context,
                CompetitionAction.MANAGE_TECHNOLOGIES,
            ),
        );
    }

    static manageEligibility(
        context: CompetitionContext,
    ): void {
        Authorization.assert(
            CompetitionPolicy.can(
                context,
                CompetitionAction.MANAGE_ELIGIBILITY,
            ),
        );
    }

    static can(
        context: CompetitionContext,
        action: CompetitionAction,
    ): void {
        Authorization.assert(
            CompetitionPolicy.can(
                context,
                action,
            ),
        );
    }
}