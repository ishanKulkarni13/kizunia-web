import { NotFoundError } from "@/lib/errors";

import { CompetitionErrorCode } from "./error-code";

export class CompetitionTypeNotFoundError extends NotFoundError {
    constructor(message = "This type is not attached to the competition.") {
        super({
            code: CompetitionErrorCode.TYPE_NOT_FOUND,
            message,
        });
    }
}
