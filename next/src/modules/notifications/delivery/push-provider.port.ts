/**
 * Notifications — Push Provider Port
 *
 * The boundary between "deliver this notification" and "how a particular vendor
 * wants to be asked" (ND-D-10).
 *
 * No file above this interface may import a provider SDK, and no file above it
 * sees a vendor error string. What it sees is a **classification** — accepted,
 * dead destination, try again, or never — because that is the only thing the
 * retry logic can act on, and because a classification is stable across
 * providers in a way error codes are not.
 *
 * Adding a second provider is one file implementing this interface plus an enum
 * value. That is the entire cost, and it is why the abstraction earns its place
 * rather than existing for symmetry.
 */

export interface PushMessage {
  /** The destination registration token. */
  readonly token: string;
  readonly title: string;
  readonly body: string;
  /**
   * Where tapping the notification leads. Site-relative, or an absolute https
   * URL for an announcement that points off-platform.
   */
  readonly link: string | null;
  /**
   * Collapse identity, set to the notification's id.
   *
   * This is the mitigation for at-least-once delivery (ND-D-05): a worker that
   * succeeds at the provider and crashes before recording will send again, and
   * exactly-once is not achievable across a provider boundary. Giving both
   * copies the same collapse identity makes the operating system *replace* the
   * first banner rather than stack a second one, so the user sees one
   * notification even though two were sent.
   */
  readonly collapseKey: string;
  /** Structured data the client receives alongside the visible message. */
  readonly data?: Readonly<Record<string, string>>;
}

/**
 * What happened, in terms the retry logic understands.
 *
 * A discriminated union rather than a boolean plus an optional error: the
 * caller must handle each case, and "succeeded but here is an error" is not a
 * state that should be representable.
 */
export type PushSendResult =
  /** The provider took responsibility for the message. Not proof of receipt. */
  | { readonly outcome: "ACCEPTED"; readonly providerMessageId: string | null }
  /**
   * The destination is dead — unregistered, or malformed. Never retry, and
   * deactivate the subscription (ND-D-09).
   */
  | { readonly outcome: "INVALID_TOKEN"; readonly code: string; readonly detail?: string }
  /** Transient. Back off and try again. */
  | { readonly outcome: "RETRYABLE"; readonly code: string; readonly detail?: string }
  /** Will fail identically forever — bad credentials, a rejected payload. */
  | { readonly outcome: "PERMANENT"; readonly code: string; readonly detail?: string };

export interface PushProvider {
  /** Which provider this is, for the delivery record. */
  readonly id: "FCM" | "FAKE";

  /**
   * Whether this provider can actually reach a device.
   *
   * False for the fake, and for a real provider whose credentials are absent.
   * The delivery layer uses it to mark deliveries `SKIPPED` with an honest
   * reason instead of recording sends that never left the building.
   */
  readonly canDeliver: boolean;

  /**
   * Sends one message to one destination.
   *
   * One at a time rather than in a batch: a user has a handful of devices, each
   * needs its own delivery record and its own outcome (ND-D-11), and a batch
   * API's partial-failure semantics would have to be unpicked back into exactly
   * that shape anyway.
   *
   * Must not throw for a delivery failure — a failure is a returned
   * classification. Throwing is reserved for the provider itself being
   * unusable, which the caller treats as retryable.
   */
  send(message: PushMessage): Promise<PushSendResult>;
}
