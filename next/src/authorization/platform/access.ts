
import { PlatformRole } from "./roles";
import { AuthorizationActor } from "../types";
type PlatformActor = Pick<AuthorizationActor, "role">;

export class PlatformAccess {
    static canBypassAuthorization(actor: PlatformActor): boolean {
        if (!actor.role) {
            return false;
        }
        
        return (
            actor.role === PlatformRole.ADMIN ||
            actor.role === PlatformRole.SUPER_ADMIN
        );
    }
}