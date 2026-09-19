import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, mcp, username } from "better-auth/plugins";
import prisma from "./prisma";
import { displayUsernameSchema, usernameSchema } from "./validation";
import { nextCookies } from "better-auth/next-js";
import { sendEmail } from "./auth/email";
import { dash } from "@better-auth/infra";
import { MCP_SUPPORTED_SCOPES } from "@/modules/mcp/auth/scopes";
import { MCP_LOGIN_PAGE, mcpResourceUrl } from "@/modules/mcp/config";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  socialProviders: {
    google: {
      clientId: String(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!),
      clientSecret: String(process.env.GOOGLE_CLIENT_SECRET!),
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
  },
  plugins: [
     dash(),
    admin(),

    /**
     * MCP / OAuth 2.1 provider.
     *
     * Turns this Better Auth instance into the authorization server that
     * MCP clients (ChatGPT and others) authenticate against, exposing
     * `/.well-known/oauth-authorization-server`, the authorize/token
     * endpoints, and RFC 7591 dynamic client registration. It composes
     * Better Auth's `oidc-provider` internally; PKCE (S256) is required by
     * that provider for public clients.
     *
     * `loginPage` is where an unauthenticated MCP authorization request is
     * sent to sign in. It must be a real Kizunia sign-in page, because the
     * whole point of the flow is that the human — not the MCP client —
     * proves who they are. After sign-in the plugin's `after` hook resumes
     * the paused authorization request.
     *
     * `resource` is this MCP server's RFC 8707 resource identifier. It is
     * advertised in protected-resource metadata and is what
     * `assertTokenAudience` checks an incoming token against, so a token
     * minted for some other resource cannot be replayed here.
     *
     * NOTE ON AUTHORITY: nothing this plugin issues is an authorization to
     * act. It establishes *which Kizunia user* is calling and *which
     * capabilities that user consented to expose*. Every MCP tool then
     * re-reads that user from the database and runs Kizunia's own
     * authorization policies. See src/modules/mcp/server/authenticate.ts.
     */
    mcp({
      loginPage: MCP_LOGIN_PAGE,
      resource: mcpResourceUrl(),
      oidcConfig: {
        loginPage: MCP_LOGIN_PAGE,
        metadata: {
          scopes_supported: [...MCP_SUPPORTED_SCOPES],
        },
      },
    }),

    username({
      usernameValidator(username) {
        if (username === "admin") {
          return false;
        }

        const { error } = usernameSchema.safeParse(username);
        if (error) {
          return false;
        }
        return true;
      },
      displayUsernameValidator: (displayUsername) => {
        const { error } = displayUsernameSchema.safeParse(displayUsername);
        if (error) {
          return false;
        }
        return true;
      },
    }),
    nextCookies(),
  ],
  emailAndPassword: {
    enabled: true,
    // requireEmailVerification: true, // Only if you want to block login completely
    async sendResetPassword({ user, url }) {
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        text: `Click the link to reset your password: ${url}`,
      });
    },
  },
});
