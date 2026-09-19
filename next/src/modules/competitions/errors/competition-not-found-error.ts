import { NotFoundError } from "@/lib/errors";

import { CompetitionErrorCode } from "./error-code";

export class CompetitionNotFoundError extends NotFoundError {
    constructor(message = "Competition not found.") {
        super({
            code: CompetitionErrorCode.NOT_FOUND,
            message,
        });
    }
}