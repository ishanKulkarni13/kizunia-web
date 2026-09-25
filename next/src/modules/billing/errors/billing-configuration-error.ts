/**
 * The billing configuration in the environment is unusable: a partial set of
 * provider credentials, a key that names no known mode, or credentials for a
 * mode this deployment does not expect.
 *
 * Deliberately not an `AppError`: it never reaches a client. It is thrown at
 * server start, from `src/instrumentation.ts`, so a misconfigured deployment
 * fails immediately with a message an operator can act on instead of running
 * with a TEST/LIVE mix-up (SB-PB-02, IB-13).
 *
 * The message names variables, never values: it must never contain a key or a
 * secret, because the boot log is the first place it would be read.
 */
export class BillingConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingConfigurationError";
  }
}
