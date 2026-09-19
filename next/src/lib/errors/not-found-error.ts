import { ErrorCategory } from "./error-category";
import { HttpStatus } from "./http-status";
import { AppError } from "./app-error";

export interface NotFoundErrorOptions {
    code: string;
    message: string;
    details?: unknown;
    cause?: unknown;
}

export class NotFoundError extends AppError {
    constructor(options: NotFoundErrorOptions) {
        super({
            ...options,
            status: HttpStatus.NOT_FOUND,
            category: ErrorCategory.RESOURCE,
        });
    }
}