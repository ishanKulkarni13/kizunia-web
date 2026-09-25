/**
 * Razorpay — HTTP Client
 *
 * A small `fetch`-based client: no SDK. Every response has to be translated
 * and classified anyway, and this adds no dependency. It does exactly four
 * things: authenticate (HTTP Basic, `key_id:key_secret`), bound the request in
 * time, record when the request was sent, and hand back the raw status and
 * parsed body. Classification (`classification.ts`) and mapping (`mapping.ts`)
 * decide what they mean.
 *
 * It knows nothing about budgets, cooldowns, plans or Kizunia. Those are
 * `BudgetedProvider` and `RazorpayBillingProvider`, and this is never called
 * except through them.
 *
 * Two facts that shape the result type:
 *
 *  - `sentAt` is taken immediately before the request is dispatched. It is the
 *    observation time the sync apply path compares to discard a stale read, so
 *    it must never be the moment the answer arrived.
 *  - A timeout or a dropped connection is `NO_RESPONSE`, not a failure of any
 *    particular kind. For a mutation the request may have been processed, so
 *    the caller reports `TIMEOUT` and the outcome is resolved by reading the
 *    provider later, never by resending.
 *
 * Never logs a request, a response, a header or a key.
 */
import { PROVIDER_CLIENT_CONFIG } from "../../config/billing-config";

const DEFAULT_BASE_URL = "https://api.razorpay.com/v1";

export type RazorpayRequestMethod = "GET" | "POST" | "PATCH";

export interface RazorpayRequestOptions {
  readonly query?: Readonly<Record<string, string | number>>;
  readonly body?: unknown;
}

export type RazorpayRawResult =
  | {
      readonly kind: "RESPONSE";
      readonly status: number;
      /** The parsed JSON body, or `undefined` when it was empty or not JSON. */
      readonly body: unknown;
      readonly sentAt: Date;
    }
  | { readonly kind: "NO_RESPONSE"; readonly sentAt: Date };

export interface RazorpayClientOptions {
  readonly keyId: string;
  readonly keySecret: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /** Injected in tests. */
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

export class RazorpayClient {
  private readonly authorization: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(options: RazorpayClientOptions) {
    this.authorization = `Basic ${Buffer.from(`${options.keyId}:${options.keySecret}`).toString("base64")}`;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? PROVIDER_CLIENT_CONFIG.requestTimeoutMs;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async request(
    method: RazorpayRequestMethod,
    path: string,
    options: RazorpayRequestOptions = {},
  ): Promise<RazorpayRawResult> {
    const url = new URL(`${this.baseUrl}${path}`);

    for (const [name, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(name, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: this.authorization,
      Accept: "application/json",
    };

    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const sentAt = this.now();

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        // Bounds the whole exchange, including reading the body.
        signal: AbortSignal.timeout(this.timeoutMs),
        // A provider response is never cacheable state.
        cache: "no-store",
      });

      return { kind: "RESPONSE", status: response.status, body: parseBody(await response.text()), sentAt };
    } catch {
      // A timeout, a reset, DNS or TLS failure, or an aborted body read.
      return { kind: "NO_RESPONSE", sentAt };
    }
  }
}

function parseBody(text: string): unknown {
  if (text.trim() === "") return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
