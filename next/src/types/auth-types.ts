import { auth } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
export type ErrorCode = keyof typeof auth.$ERROR_CODES | "UNKNOWN";

export interface DeviceSession {
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
    token: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  };
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    image?: string | null | undefined;
  };
}

export interface Subscription {
  limits: Record<string, number> | undefined;
  priceId: string | undefined;
  id: string;
  plan: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  trialStart?: Date;
  trialEnd?: Date;
  referenceId: string;
  status:
    | "active"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "past_due"
    | "paused"
    | "trialing"
    | "unpaid";
  periodStart?: Date;
  periodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  groupId?: string;
  seats?: number;
}
