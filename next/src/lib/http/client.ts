import { ApiError } from "./api-error";
import type { ErrorResponse, SuccessResponse } from "./response-body";

export class HttpClient {
  private static async parseResponse<T>(
    response: Response,
  ): Promise<SuccessResponse<T>> {
    const body: unknown = await response.json();

    if (!response.ok) {
      const error = body as ErrorResponse;

      throw new ApiError(response.status, error.error);
    }

    return body as SuccessResponse<T>;
  }

  static async get<TResponse>(
    url: string,
    init?: RequestInit,
  ): Promise<SuccessResponse<TResponse>> {
    const response = await fetch(`${url}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    return this.parseResponse<TResponse>(response);
  }

  static async post<TResponse, TBody = undefined>(
    url: string,
    body?: TBody,
    init?: RequestInit,
  ): Promise<SuccessResponse<TResponse>> {
    const response = await fetch(url, {
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      ...init,
    });

    return this.parseResponse<TResponse>(response);
  }

  static async put<TResponse, TBody = undefined>(
    url: string,
    body?: TBody,
    init?: RequestInit,
  ): Promise<SuccessResponse<TResponse>> {
    const response = await fetch(url, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      ...init,
    });

    return this.parseResponse<TResponse>(response);
  }

  static async patch<TResponse, TBody>(
    url: string,
    body: TBody,
    init?: RequestInit,
  ): Promise<SuccessResponse<TResponse>> {
    const response = await fetch(url, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      ...init,
    });

    return this.parseResponse<TResponse>(response);
  }

  static async delete<TResponse>(
    url: string,
    init?: RequestInit,
  ): Promise<SuccessResponse<TResponse>> {
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      ...init,
    });

    return this.parseResponse<TResponse>(response);
  }
}
