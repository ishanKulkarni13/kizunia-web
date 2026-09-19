import { Authorization } from "@/authorization";
import { PlatformAction } from "@/authorization/platform/actions";
import type { PlatformContext } from "@/authorization/platform/context";
import { PlatformPolicy } from "@/authorization/platform/policy";

/**
 * Technology is a global catalog entity with no per-instance ownership
 * (unlike Project/Competition/Portfolio, which have member roles) — there is
 * no resource-scoped context, policy or permission set to build here. Every
 * mutation (create/edit/slug/delete/restore/icon) gates on the exact same
 * platform capability, so this is a thin, single-method wrapper around
 * `PlatformAuthorizer.can`, kept as its own class only to match this
 * module's `XxxAuthorizer.method(context)` convention (see
 * `CompetitionAuthorizer`) rather than sprinkling `PlatformAuthorizer.can`
 * calls directly through the service.
 */
export class TechnologyAuthorizer {
    static manage(context: PlatformContext): void {
        Authorization.assert(
            PlatformPolicy.can(context, PlatformAction.MANAGE_TECHNOLOGIES),
        );
    }
}
