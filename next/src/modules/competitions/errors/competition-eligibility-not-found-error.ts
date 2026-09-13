import { NotFoundError } from "@/lib/errors";

import { CompetitionErrorCode } from "./error-code";

export class CompetitionEligibilityNotFoundError extends NotFoundError {
    constructor(message = "This eligibility value is not attached to the competition.") {
        super({
            code: CompetitionErrorCode.ELIGIBILITY_NOT_FOUND,
            message,
        });
    }
}
