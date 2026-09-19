import { AppError } from "./app-error";

export function isAppError(
    error: unknown,
): error is AppError {
    return error instanceof AppError;
}