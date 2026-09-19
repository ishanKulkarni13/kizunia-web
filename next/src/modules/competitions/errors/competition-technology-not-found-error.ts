import { NotFoundError } from "@/lib/errors";

import { CompetitionErrorCode } from "./error-code";

export class CompetitionTechnologyNotFoundError extends NotFoundError {
    constructor(message = "This technology is not attached to the competition.") {
        super({
            code: CompetitionErrorCode.TECHNOLOGY_NOT_FOUND,
            message,
        });
    }
}
