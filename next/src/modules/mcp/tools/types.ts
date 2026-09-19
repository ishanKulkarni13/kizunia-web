import type { ZodType } from "zod";

import type { RateLimitPolicyId } from "@/lib/rate-limit";

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
 *
 * `rateLimitPolicy` is required, not optional, and deliberately lives on the
 * tool itself rather than in a side lookup table dispatch.ts maintains: a
 * side table can silently fall out of sync the day a new tool is added and
 * nobody remembers to list it there, which is exactly the "new tool ships
 * unrated" gap this field closes. Because it's a required property of
 * `McpTool`, an object missing it fails to typecheck as one — a new tool
 * cannot be added to `MCP_TOOLS` without its author making an explicit
 * classification decision. `handleToolsCall` additionally treats an
 * unrecognised/malformed value as a hard rejection rather than a silent
 * pass-through, so the invariant holds even against a value that reaches
 * this far only via `any`/unsafe casts.
 */
export interface McpTool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: ZodType<TInput>;
  readonly rateLimitPolicy: RateLimitPolicyId;
  execute(context: McpRequestContext, input: TInput): Promise<unknown>;
}
