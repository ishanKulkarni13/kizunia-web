import { ConflictError } from "@/lib/errors";
import { HttpStatus } from "@/lib/errors";

import { CompetitionErrorCode } from "./error-code";

export class DuplicateSlugError extends ConflictError {
    constructor(slug: string) {
        super({
            code: CompetitionErrorCode.DUPLICATE_SLUG,
            status: HttpStatus.CONFLICT,
            message: `Competition slug "${slug}" already exists.`,
            details: {
                slug,
            },
        });
    }
}