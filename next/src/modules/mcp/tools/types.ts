import type { ZodType } from "zod";

import type { McpRequestContext } from "../server/context/request-context";

/**
 * The shape every MCP tool adapter implements.
 *
 * A tool is a thin, self-describing wrapper: a name and description for
 * discovery, an input schema for validation, and an `execute` that
 * delegates to exactly one application-layer use case. Enforced by
 * convention rather than by a base class — a base class here would buy
 * nothing beyond what the type already guarantees, and would be one more
 * layer to look through when reading a tool.
 *
 * `TInput` is the *parsed* input type (`z.infer<TSchema>`); the transport
 * (`server/transport/dispatch.ts`) parses the raw JSON-RPC arguments through
 * `inputSchema` before a tool ever sees them, so `execute` never receives
 * unvalidated data.
 */
export interface McpTool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<TInput>;
  execute(context: McpRequestContext, input: TInput): Promise<unknown>;
}
