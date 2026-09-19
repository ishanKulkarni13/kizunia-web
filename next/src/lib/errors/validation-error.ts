import { AppError, type AppErrorOptions } from "./app-error";
import { ErrorCategory } from "./error-category";

export type ValidationErrorOptions =
    Omit<AppErrorOptions, "category">;

export class ValidationError extends AppError {
    constructor(options: ValidationErrorOptions) {
        super({
            ...options,
            category: ErrorCategory.VALIDATION,
        });
    }
}