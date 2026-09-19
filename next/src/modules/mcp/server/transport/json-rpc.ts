/**
 * JSON-RPC 2.0 envelope types — the wire format MCP is built on.
 *
 * Kept minimal and separate from MCP-specific method handling
 * (`dispatch.ts`) so the two concerns — "is this a valid JSON-RPC message"
 * and "what does the `tools/call` method do" — can be read and tested
 * independently.
 */

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: string | number | null;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/**
 * True for a structurally valid JSON-RPC 2.0 request. Deliberately loose
 * about `id` (JSON-RPC allows omitting it for notifications) and about
 * `params` (validated per-method downstream, not here).
 */
export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return record.jsonrpc === "2.0" && typeof record.method === "string";
}

export function jsonRpcResult(
  id: string | number | null,
  result: unknown,
): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}
