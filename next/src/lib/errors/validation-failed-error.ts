
import { ValidationError } from "./validation-error";
import { HttpStatus } from "./http-status";

export class ValidationFailedError extends ValidationError {
    constructor(details: unknown) {
        super({
            code: "VALIDATION_FAILED",
            status: HttpStatus.UNPROCESSABLE_ENTITY,
            message: "Request validation failed.",
            details,
        });
    }
}