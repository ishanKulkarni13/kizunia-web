import { AppError, type AppErrorOptions } from "./app-error";
import { ErrorCategory } from "./error-category";

export type AuthenticationErrorOptions =
    Omit<AppErrorOptions, "category">;

export class AuthenticationError extends AppError {
    constructor(options: AuthenticationErrorOptions) {
        super({
            ...options,
            category: ErrorCategory.AUTHENTICATION,
        });
    }
}