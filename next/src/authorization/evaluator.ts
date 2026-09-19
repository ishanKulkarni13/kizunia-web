import { PlatformAccess } from ".";
import { AuthorizationCode, type AuthorizationDecision } from "./types";
import type { AuthorizationContext } from "./types/context";
import { allow, deny } from "./utils";

export class AuthorizationEvaluator<
  TContext extends AuthorizationContext,
  TAction,
  TRole extends string,
> {
  /**
   * A terminal decision.
   *
   * Once set, no further rules are evaluated.
   */
  private terminalDecision: AuthorizationDecision | null = null;

  /**
   * Indicates that at least one authorization rule
   * explicitly granted access.
   */
  private allowed = false;

  private constructor(private readonly context: TContext) {}

  static start<
    TContext extends AuthorizationContext,
    TAction,
    TRole extends string,
  >(context: TContext) {
    return new AuthorizationEvaluator<TContext, TAction, TRole>(context);
  }

  // ===========================================================================
  // Platform Override
  // ===========================================================================

  platformOverride() {
    if (this.terminalDecision) {
      return this;
    }

    if (PlatformAccess.canBypassAuthorization(this.context.actor)) {
      this.terminalDecision = allow();
    }

    return this;
  }

  // ===========================================================================
  // Security
  // ===========================================================================

  security(
    predicate: (context: TContext) => boolean,
    code: AuthorizationCode,
    message: string,
  ) {
    if (this.terminalDecision) {
      return this;
    }

    if (!predicate(this.context)) {
      this.terminalDecision = deny(code, message);
    }

    return this;
  }

  // ===========================================================================
  // Permission
  // ===========================================================================

  permission(
    permissionSet: Readonly<Record<TRole, ReadonlySet<TAction>>>,
    role: TRole | null | undefined,
    action: TAction,
  ) {
    if (this.terminalDecision) {
      return this;
    }

    if (!role) {
      this.terminalDecision = deny(
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "You do not have permission to perform this action.",
      );

      return this;
    }

    const permissions: ReadonlySet<TAction> | undefined = permissionSet[role];

    // A role with no entry in the permission set must deny, not throw.
    // Reaching `undefined.has(...)` turns an authorization decision into a
    // 500, and an unrecognised role is precisely when failing closed
    // matters most.
    if (!permissions || !permissions.has(action)) {
      this.terminalDecision = deny(
        AuthorizationCode.ROLE_PERMISSION_DENIED,
        "You do not have permission to perform this action.",
      );

      return this;
    }

    this.allowed = true;

    return this;
  }

  // ===========================================================================
  // Requirement
  // ===========================================================================

  require(
    predicate: (context: TContext) => boolean,
    code: AuthorizationCode,
    message: string,
  ) {
    if (this.terminalDecision) {
      return this;
    }

    if (!predicate(this.context)) {
      this.terminalDecision = deny(code, message);
    }

    return this;
  }

  // ===========================================================================
  // Explicit Allow
  // ===========================================================================

  grant() {
    if (this.terminalDecision) {
      return this;
    }

    this.allowed = true;

    return this;
  }

  // ===========================================================================
  // Final Decision
  // ===========================================================================

  evaluate(): AuthorizationDecision {
    if (this.terminalDecision) {
      return this.terminalDecision;
    }

    if (this.allowed) {
      return allow();
    }

    return deny(
      AuthorizationCode.ROLE_PERMISSION_DENIED,
      "Access denied.",
    );
  }

  /**
   * Alias for evaluate()
   */
  allow(): AuthorizationDecision {
    return this.evaluate();
  }
}