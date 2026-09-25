/**
 * Next.js instrumentation hook — runs once when the server starts.
 *
 * Today it does one thing: validate billing configuration. The provider mode
 * is resolved from the credentials here, at boot, and a misconfiguration
 * (partial credentials, an unrecognized key prefix, or credentials for a mode
 * this deployment does not expect) throws, which stops the server from
 * starting with a message naming the problem (SB-PB-02, IB-13,
 * docs/architecture/subscription/provider-availability/environments.md).
 *
 * No billing configuration at all is not an error: it resolves to the
 * supported `DISABLED` state and the application runs with Free, grants and
 * every entitlement gate working.
 *
 * The import is dynamic and gated to the Node.js runtime, so the edge bundle
 * never pulls in billing code, and it is skipped while `next build` collects
 * page data: validation belongs to a server that is about to serve requests,
 * not to a build machine that may not carry the runtime environment.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { validateBillingConfigurationAtBoot } = await import(
    "@/modules/billing/provider/provider-mode"
  );

  validateBillingConfigurationAtBoot();
}
