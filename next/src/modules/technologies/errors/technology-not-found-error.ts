import { NotFoundError } from "@/lib/errors";

import { TechnologyErrorCode } from "./error-code";

export class TechnologyNotFoundError extends NotFoundError {
    constructor(message = "Technology not found.") {
        super({
            code: TechnologyErrorCode.NOT_FOUND,
            message,
        });
    }
}
