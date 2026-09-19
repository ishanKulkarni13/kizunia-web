/**
 * MCP-facing errors.
 *
 * This is the *only* place MCP decides what an MCP client is told when
 * something goes wrong. Domain code never constructs these — it throws
 * Kizunia's own `AppError` subclasses, and `toMcpToolFailure` translates.
 * Keeping the translation in one direction (domain → MCP, never the
 * reverse) is what keeps the domain free of MCP concepts.
 */

/**
 * JSON-RPC 2.0 error codes used by this server.
 *
 * The four below -32600 are the spec's reserved codes and mean exactly what
 * the spec says. `UNAUTHORIZED` sits in the implementation-defined server
 * range (-32000..-32099) and matches what `withMcpAuth` emits for a missing
 * or expired token, so an authentication failure looks the same whether it
 * was rejected by the transport wrapper or by our own audience check.
 */
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32000,
} as const;

export type JsonRpcErrorCode =
  (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

/**
 * A protocol-level failure: the request could not be dispatched at all.
 *
 * Distinct from a *tool* failure, which is a successful JSON-RPC response
 * carrying `isError: true`. The MCP specification draws this line
 * deliberately — a tool that refuses to act is a result the model should
 * see and can react to, whereas a malformed envelope or a bad token is not
 * something the model can do anything about.
 */
export class McpProtocolError extends Error {
  readonly code: JsonRpcErrorCode;

  /** HTTP status for the transport to use. JSON-RPC itself has no status. */
  readonly httpStatus: number;

  constructor(options: {
    code: JsonRpcErrorCode;
    message: string;
    httpStatus?: number;
  }) {
    super(options.message);

    this.name = "McpProtocolError";
    this.code = options.code;
    this.httpStatus = options.httpStatus ?? 200;
  }
}

/**
 * The token presented is not usable for this resource.
 *
 * Carries 401 so the transport can attach `WWW-Authenticate` and point the
 * client at protected-resource metadata, which is how an MCP client knows
 * to start (or restart) the OAuth flow.
 */
export class McpUnauthorizedError extends McpProtocolError {
  constructor(message: string) {
    super({
      code: JsonRpcErrorCode.UNAUTHORIZED,
      message,
      httpStatus: 401,
    });

    this.name = "McpUnauthorizedError";
  }
}

/**
 * The access token does not carry a scope required for this tool.
 *
 * Deliberately NOT the same thing as a Kizunia authorization denial. This
 * says "the user never allowed this client to attempt this"; a Kizunia
 * denial says "this user may not do this at all". Both are refusals, but
 * only the first is fixable by re-consenting with a broader scope, and the
 * message keeps that distinction visible to whoever is debugging.
 */
export class McpScopeError extends Error {
  readonly requiredScope: string;

  constructor(requiredScope: string) {
    super(
      `This MCP client was not granted the "${requiredScope}" scope. ` +
        `Reconnect the Kizunia connector and approve that capability.`,
    );

    this.name = "McpScopeError";
    this.requiredScope = requiredScope;
  }
}
