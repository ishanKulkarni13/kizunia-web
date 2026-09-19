import prisma from "@/lib/prisma";

import type { AuthorizationActor } from "@/authorization";
import type { PlatformContext } from "./context";
import { InternalError } from "@/lib/errors";
import { UserNotFoundError } from "@/modules/users/backend/errors";


export class PlatformContextResolver {
  static async resolve(
    actor: AuthorizationActor,
  ): Promise<PlatformContext> {

    if (!actor.id) {
      throw new InternalError({
        message: "Actor ID is required to resolve the platform context.",
        code: "PLATFORM_CONTEXT_RESOLUTION_ERROR",
        status: 500,
        details: "The actor ID is missing or undefined. Cannot resolve platform context without a valid actor ID.",
      });
    }
     
    

    const user = await prisma.user.findUnique({
      where: {
        id: actor.id,
      },
      select: {
        id: true,
        role: true,
        banned: true,
      },
    });

    if (!user) {
      throw new UserNotFoundError( 
        actor.id,
      );
    }

    return {
      actor: user,
    };
  }
}