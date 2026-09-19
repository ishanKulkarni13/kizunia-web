import { ConflictError, HttpStatus } from "@/lib/errors";

import { TechnologyErrorCode } from "./error-code";

/**
 * Raised when a create/update would violate Technology's unique constraints
 * (`name` or `slug`). Both fields are independently unique, so the
 * repository tells this error which one Postgres actually rejected (via the
 * P2002 `meta.target`) rather than guessing.
 */
export class DuplicateTechnologyError extends ConflictError {
    constructor(field: "name" | "slug", value: string) {
        super({
            code:
                field === "name"
                    ? TechnologyErrorCode.DUPLICATE_NAME
                    : TechnologyErrorCode.DUPLICATE_SLUG,
            status: HttpStatus.CONFLICT,
            message: `Technology ${field} "${value}" already exists.`,
            details: {
                field,
                value,
            },
        });
    }
}
