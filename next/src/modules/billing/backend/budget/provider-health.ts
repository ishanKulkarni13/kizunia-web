/**
 * Billing — Provider Health Tracker
 *
 * Joins the pure cooldown policy to its persistence: it answers "may a call go
 * out right now?" from the shared row, and folds each provider result back into
 * it. It is the `ProviderHealth` port `BudgetedProvider` depends on.
 *
 * Recording is read, compute, compare-and-set, with a few retries when another
 * instance won the race. A healthy result on an already-clean state writes
 * nothing, so the common case, a successful call, costs one read.
 *
 * What it reports:
 *  - `cooldown.entered` / `cooldown.left`, with the level and the end time;
 *  - a `billing.alert` for an authentication failure. That one pages: it stops
 *    ALL billing until the credentials are fixed, and it must not go unnoticed.
 *
 * It never logs a key. The pin stores only a fingerprint of the key ID.
 */
import { createHash } from "node:crypto";

import type { ProviderFailureClass, ProviderMode } from "@/generated/prisma";

import { COOLDOWN_CONFIG } from "../../config/billing-config";
import {
  applyHealthEvent,
  healthEventFor,
  isAuthPinned,
  isClean,
  isCoolingDown,
  type CooldownSettings,
} from "../../policy/cooldown";
import { logBillingAlert, logBillingEvent } from "../../observability/log";
import type { ProviderHealth, ProviderVerdict } from "../../provider/budgeted-provider";
import { CooldownRepository } from "./cooldown.repository";

/** Attempts to record one result before conceding to a faster writer. */
const MAX_RECORD_ATTEMPTS = 3;

/**
 * A non-reversible fingerprint of the configured API key ID. The pin is held
 * only while this matches, so rotating the key and redeploying un-pins with no
 * manual SQL. The key ID identifies a key and is not a secret; hashing it keeps
 * even that out of the table.
 */
export function keyFingerprint(keyId: string): string {
  return createHash("sha256").update(keyId).digest("hex").slice(0, 16);
}

export interface ProviderHealthTrackerOptions {
  readonly repository?: CooldownRepository;
  readonly settings?: CooldownSettings;
  readonly now?: () => Date;
  readonly random?: () => number;
}

export class ProviderHealthTracker implements ProviderHealth {
  private readonly repository: CooldownRepository;
  private readonly settings: CooldownSettings;
  private readonly now: () => Date;
  private readonly random: (() => number) | undefined;

  constructor(
    private readonly mode: ProviderMode,
    private readonly currentKeyFingerprint: string,
    options: ProviderHealthTrackerOptions = {},
  ) {
    this.repository = options.repository ?? new CooldownRepository();
    this.settings = options.settings ?? COOLDOWN_CONFIG;
    this.now = options.now ?? (() => new Date());
    this.random = options.random;
  }

  async verdict(): Promise<ProviderVerdict> {
    const { state } = await this.repository.load(this.mode);

    if (isAuthPinned(state, this.currentKeyFingerprint)) return "AUTH_PINNED";
    if (isCoolingDown(state, this.now())) return "COOLING_DOWN";

    return "CLEAR";
  }

  async record(result: ProviderFailureClass | "SUCCESS"): Promise<void> {
    const event = healthEventFor(result, this.currentKeyFingerprint);

    if (event === null) return;

    for (let attempt = 0; attempt < MAX_RECORD_ATTEMPTS; attempt += 1) {
      const loaded = await this.repository.load(this.mode);

      // The common case: a healthy call against a healthy provider.
      if (event.kind === "HEALTHY" && isClean(loaded.state)) return;

      const now = this.now();
      const { state, entered, left } = applyHealthEvent(loaded.state, event, {
        now,
        settings: this.settings,
        random: this.random,
      });

      if (!(await this.repository.compareAndSet(this.mode, loaded, state))) continue;

      if (entered) {
        logBillingEvent("cooldown.entered", {
          mode: this.mode,
          level: state.cooldownLevel,
          until: state.cooldownUntil?.toISOString(),
          cause: event.kind,
        });
      }

      if (left) logBillingEvent("cooldown.left", { mode: this.mode, level: state.cooldownLevel });

      if (event.kind === "AUTH_FAILURE") {
        // Every provider call now stops until the key changes.
        logBillingAlert("AUTH_FAILURE", "PAGE", { mode: this.mode });
      }

      return;
    }

    // Another instance kept winning. Its write reflects the same outage, so
    // conceding loses nothing worth a retry storm.
    logBillingEvent("health.record_conceded", { mode: this.mode, result });
  }
}
