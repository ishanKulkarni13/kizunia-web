import {
    ForbiddenError,
} from "@/lib/errors";

import type { AuthorizationDecision } from "./types";

export class Authorization {
    static assert(
        decision: AuthorizationDecision,
    ): void {
        if (decision.allowed) {
            return;
        }

        throw new ForbiddenError({
            code: decision.code,
            message: decision.message,
        });
    }
}