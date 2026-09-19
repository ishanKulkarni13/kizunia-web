import {
  AuthorizationCode,
  AuthorizationDecision,
  AuthorizationEvaluator,
} from "@/authorization";

import { PlatformAction } from "./actions";
import type { PlatformContext } from "./context";
import { PlatformPermissionSet } from "./permission-set";

export class PlatformPolicy {
  static can(
    context: PlatformContext,
    action: PlatformAction,
  ): AuthorizationDecision {
    return (
      AuthorizationEvaluator
        // .start(context)
        // .platformOverride()
        // .security(
        //     ctx => !ctx.actor.banned,
        //     AuthorizationCode.ACCOUNT_BANNED,
        //     "Your account has been banned.",
        // )
        // .allow();
        .start(context)

        .security(
          (ctx) => !ctx.actor.banned,
          AuthorizationCode.ACCOUNT_BANNED,
          "Your account has been banned.",
        )

        .permission(PlatformPermissionSet, context.actor.role, action)

        .allow()
    );
  }
}
