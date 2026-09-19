import { NotFoundError } from "@/lib/errors";

import { CompetitionErrorCode } from "./error-code";

export class CompetitionLocationNotFoundError extends NotFoundError {
    constructor(message = "Competition location not found.") {
        super({
            code: CompetitionErrorCode.LOCATION_NOT_FOUND,
            message,
        });
    }
}
