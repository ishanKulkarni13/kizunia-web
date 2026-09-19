import { createAuthClient } from "better-auth/react";
import { adminClient, usernameClient } from "better-auth/client/plugins";
import { sentinelClient } from "@better-auth/infra/client";

export const authClient = createAuthClient({
  plugins: [
    sentinelClient(),
    adminClient(),
    usernameClient(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
