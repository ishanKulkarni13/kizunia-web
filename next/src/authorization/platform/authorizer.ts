import { Authorization } from "../assert";
import { PlatformAction } from "./actions";
import { PlatformContext } from "./context";
import { PlatformPolicy } from "./policy";


export class PlatformAuthorizer {
    static can(
        context: PlatformContext,
        action: PlatformAction,
    ): void {
        Authorization.assert(
            PlatformPolicy.can(
                context,
                action,
            ),
        );
    }
}

