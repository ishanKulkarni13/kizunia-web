import { ApiError } from "./api-error";
import type { ErrorResponse, SuccessResponse } from "./response-body";

export class HttpClient {
  /**
   * JSON by default, with the caller's headers merged on top. `init` is spread
   * *before* the headers so a caller adding one header (an `Idempotency-Key`,
   * say) never replaces the whole object and loses `Content-Type`.
   */
  private static headersFor(init?: RequestInit): Headers {
    const headers = new Headers(init?.headers);

    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    return headers;
  }

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
      headers: HttpClient.headersFor(init),
    });

    return this.parseResponse<TResponse>(response);
  }

  static async post<TResponse, TBody = undefined>(
    url: string,
    body?: TBody,
    init?: RequestInit,
  ): Promise<SuccessResponse<TResponse>> {
    const response = await fetch(url, {
      ...init,
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: HttpClient.headersFor(init),
    });

    return this.parseResponse<TResponse>(response);
  }

  static async put<TResponse, TBody = undefined>(
    url: string,
    body?: TBody,
    init?: RequestInit,
  ): Promise<SuccessResponse<TResponse>> {
    const response = await fetch(url, {
      ...init,
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      headers: HttpClient.headersFor(init),
    });

    return this.parseResponse<TResponse>(response);
  }

  static async patch<TResponse, TBody>(
    url: string,
    body: TBody,
    init?: RequestInit,
  ): Promise<SuccessResponse<TResponse>> {
    const response = await fetch(url, {
      ...init,
      method: "PATCH",
      body: JSON.stringify(body),
      headers: HttpClient.headersFor(init),
    });

    return this.parseResponse<TResponse>(response);
  }

  static async delete<TResponse>(
    url: string,
    init?: RequestInit,
  ): Promise<SuccessResponse<TResponse>> {
    const response = await fetch(url, {
      ...init,
      method: "DELETE",
      headers: HttpClient.headersFor(init),
    });

    return this.parseResponse<TResponse>(response);
  }
}
