import { auth } from "@/lib/auth";

import {
  AuthorizationCode,
  StrictAuthorizationActor,
  type AuthorizationActor,
} from "@/authorization";
import type { NextRequest } from "next/server";
import { AuthenticationError } from "../errors";
import { headers } from "next/headers";
import { logger, setLogActorId } from "@/lib/logger";

export class SessionService {
  /**
   * Used by API Routes.
   */
  static async getActor(request: NextRequest): Promise<AuthorizationActor>;

  /**
   * Used by Server Components, Server Actions and other server-side code.
   */
  static async getActor(): Promise<AuthorizationActor>;

  static async getActor(request?: NextRequest): Promise<AuthorizationActor> {
    const requestHeaders = request ? request.headers : await headers();

    const session = await auth.api.getSession({
      headers: requestHeaders,
    });

    if (!session?.user) {
      logger.warn("auth.session_rejected");

      throw new AuthenticationError({
        status: 401,
        message: "User is not authenticated.",
        code: "UNAUTHORIZED",
      });
    }

    // Records the actor id for the request-scoped log context, now that
    // session resolution — the one lookup this already required — has
    // happened. This is bookkeeping for correlation, not an authorization
    // decision: it runs on every successful session resolution, before any
    // authorization check, and the logger has no say in whether the actor is
    // allowed to do anything.
    setLogActorId(session.user.id);

    return {
      id: session.user.id,
      role: session.user.role,
      banned: session.user.banned,
    };
  }

  static async getStrictActor(
    request: NextRequest,
  ): Promise<StrictAuthorizationActor>;

  static async getStrictActor(): Promise<StrictAuthorizationActor>;

  static async getStrictActor(
    request?: NextRequest,
  ): Promise<StrictAuthorizationActor> {
    let actor;
    if (!request) {
      actor = await this.getActor();
    } else {
      actor = await this.getActor(request);
    }

    if (!actor ||!actor.id || !actor.role || actor.banned === undefined) {
      logger.warn("auth.strict_actor_incomplete");

      throw new AuthenticationError({
        status: 401,
        message: "User is not authenticated.",
        code: "UNAUTHORIZED",
      });
    }

    return {
      id: actor.id,
      role: actor.role,
      banned: actor.banned === true ? true : false,
    };
  }

  /**
   * Used by API Routes.
   */
  static async getOptionalActor(
    request: NextRequest,
  ): Promise<AuthorizationActor | null>;

  /**
   * Used by Server Components.
   */
  static async getOptionalActor(): Promise<AuthorizationActor | null>;

  static async getOptionalActor(
    request?: NextRequest,
  ): Promise<AuthorizationActor | null> {
    const requestHeaders = request ? request.headers : await headers();

    const session = await auth.api.getSession({
      headers: requestHeaders,
    });

    if (!session?.user) {
      return null;
    }

    setLogActorId(session.user.id);

    return {
      id: session.user.id,
      role: session.user.role,
      banned: session.user.banned,
    };
  }
}
