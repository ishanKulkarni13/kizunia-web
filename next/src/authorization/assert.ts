import {
    ForbiddenError,
} from "@/lib/errors";

import type { AuthorizationDecision } from "./types";

export interface AssertOptions {
    /**
     * Structured facts about a denial that a client can act on, e.g. the
     * `{ limit, owned }` of a quota refusal. Never secrets or plan names.
     */
    readonly details?: unknown;
}

export class Authorization {
    static assert(
        decision: AuthorizationDecision,
        options: AssertOptions = {},
    ): void {
        if (decision.allowed) {
            return;
        }

        throw new ForbiddenError({
            code: decision.code,
            message: decision.message,
            ...(options.details !== undefined && { details: options.details }),
        });
    }
}
