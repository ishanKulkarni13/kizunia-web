/**
 * Notifications — Fake Push Provider
 *
 * Records what would have been sent, and returns whatever outcome the test
 * scripted.
 *
 * It is not only a test double. It is also what runs when Firebase credentials
 * are absent, which is the normal state of local development and of this
 * repository until someone configures a project. That dual role is deliberate:
 * the delivery pipeline then behaves identically in development and in
 * production, differing only in whether a message leaves the building, so the
 * code path that runs in production is the one that was exercised all along.
 *
 * `canDeliver` is false, so the delivery layer records a `SKIPPED` with an
 * honest reason rather than a `SENT` that never happened. The one thing a
 * delivery system must never do is claim to have delivered something.
 */
import type {
  PushMessage,
  PushProvider,
  PushSendResult,
} from "./push-provider.port";

export interface RecordedSend {
  readonly message: PushMessage;
  readonly at: Date;
}

/** Decides what a given send returns. Defaults to accepting everything. */
export type FakeOutcomeScript = (
  message: PushMessage,
  callIndex: number,
) => PushSendResult;

const acceptEverything: FakeOutcomeScript = (_message, callIndex) => ({
  outcome: "ACCEPTED",
  providerMessageId: `fake-message-${callIndex}`,
});

export class FakePushProvider implements PushProvider {
  readonly id = "FAKE" as const;

  /**
   * Overridable so a test can exercise the "provider is configured and really
   * sends" path — the one that produces `SENT` rather than `SKIPPED` — without
   * needing a Firebase project.
   */
  readonly canDeliver: boolean;

  private readonly script: FakeOutcomeScript;

  private readonly sends: RecordedSend[] = [];

  constructor(options: { script?: FakeOutcomeScript; canDeliver?: boolean } = {}) {
    this.script = options.script ?? acceptEverything;
    this.canDeliver = options.canDeliver ?? false;
  }

  async send(message: PushMessage): Promise<PushSendResult> {
    const callIndex = this.sends.length;
    this.sends.push({ message, at: new Date() });

    return this.script(message, callIndex);
  }

  /** Everything sent so far, in order. */
  get recorded(): readonly RecordedSend[] {
    return this.sends;
  }

  get callCount(): number {
    return this.sends.length;
  }

  reset(): void {
    this.sends.length = 0;
  }
}

/** A script that returns a fixed sequence, then repeats the last entry. */
export function scriptedOutcomes(
  ...outcomes: readonly PushSendResult[]
): FakeOutcomeScript {
  return (_message, callIndex) =>
    outcomes[Math.min(callIndex, outcomes.length - 1)] ?? {
      outcome: "ACCEPTED",
      providerMessageId: null,
    };
}

/** A script keyed by destination token, for per-device outcomes (ND-D-11). */
export function outcomesByToken(
  byToken: Readonly<Record<string, PushSendResult>>,
  fallback: PushSendResult = { outcome: "ACCEPTED", providerMessageId: null },
): FakeOutcomeScript {
  return (message) => byToken[message.token] ?? fallback;
}
