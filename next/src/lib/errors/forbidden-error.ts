import { AuthorizationError } from "./authorization-error";
import { HttpStatus } from "./http-status";

export type ForbiddenErrorOptions =
    Omit<
        ConstructorParameters<typeof AuthorizationError>[0],
        "status"
    >;

export class ForbiddenError extends AuthorizationError {
    constructor(options: ForbiddenErrorOptions) {
        super({
            ...options,
            status: HttpStatus.FORBIDDEN,
        });
    }
}