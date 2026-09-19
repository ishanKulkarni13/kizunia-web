import { AppError, type AppErrorOptions } from "./app-error";
import { ErrorCategory } from "./error-category";

export type AuthorizationErrorOptions =
    Omit<AppErrorOptions, "category">;

export class AuthorizationError extends AppError {
    constructor(options: AuthorizationErrorOptions) {
        super({
            ...options,
            category: ErrorCategory.AUTHORIZATION,
        });
    }
}