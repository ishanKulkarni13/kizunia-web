import { AuthenticationError } from "./authentication-error";
import { HttpStatus } from "./http-status";

export type UnauthorizedErrorOptions =
    Omit<
        ConstructorParameters<typeof AuthenticationError>[0],
        "status"
    >;

export class UnauthorizedError extends AuthenticationError {
    constructor(options: UnauthorizedErrorOptions) {
        super({
            ...options,
            status: HttpStatus.UNAUTHORIZED,
        });
    }
}