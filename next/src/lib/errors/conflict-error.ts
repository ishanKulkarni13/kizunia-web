import { AppError, type AppErrorOptions } from "./app-error";
import { ErrorCategory } from "./error-category";

export type ConflictErrorOptions =
    Omit<AppErrorOptions, "category">;

export class ConflictError extends AppError {
    constructor(options: ConflictErrorOptions) {
        super({
            ...options,
            category: ErrorCategory.CONFLICT,
        });
    }
}