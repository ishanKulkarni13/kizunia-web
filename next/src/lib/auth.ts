import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, username } from "better-auth/plugins";
import prisma from "./prisma";
import { displayUsernameSchema, usernameSchema } from "./validation";
import { nextCookies } from "better-auth/next-js";
import { sendEmail } from "./auth/email";
import { dash } from "@better-auth/infra";

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
