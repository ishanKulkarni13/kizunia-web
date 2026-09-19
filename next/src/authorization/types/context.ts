// import type { User } from "@/generated/prisma";

import { PlatformRole } from "../platform/roles";

// export interface AuthorizationContext {
//     actor: Pick<User, "role" | "banned">;
// }

export interface AuthorizationActor {
    id: string | null | undefined;
    role: PlatformRole | string | null | undefined; //TODO: change to PlatformRole | null when all roles are migrated to platform roles
    banned: boolean | null | undefined;
}

export interface StrictAuthorizationActor extends AuthorizationActor {
    id: string;
    role: PlatformRole | string;
    banned: boolean;
}


export interface AuthorizationContext {
    actor: AuthorizationActor;
}