import { AppError, type AppErrorOptions } from "./app-error";
import { ErrorCategory } from "./error-category";

export type ResourceErrorOptions =
    Omit<AppErrorOptions, "category">;

export class ResourceError extends AppError {
    constructor(options: ResourceErrorOptions) {
        super({
            ...options,
            category: ErrorCategory.RESOURCE,
        });
    }
}