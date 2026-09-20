import { NotificationIntent, Prisma } from "@/generated/prisma";
import prisma from "@/lib/prisma";

export class NotificationPreferenceRepository {
  /**
   * Database Layer
   *
   * Responsibilities
   * ----------------
   * ✓ Build Prisma queries
   * ✓ Execute database operations
   *
   * Does NOT
   * ----------------
   * ✗ Business rules (e.g. defaulting a missing intent to disabled)
   * ✗ Authentication
   * ✗ Authorization
   */

  static async findByUser(
    userId: string,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return db.notificationPreference.findMany({ where: { userId } });
  }

  static async upsert(
    userId: string,
    intent: NotificationIntent,
    enabled: boolean,
    db: Prisma.TransactionClient | typeof prisma = prisma,
  ) {
    return db.notificationPreference.upsert({
      where: { userId_intent: { userId, intent } },
      create: { userId, intent, enabled },
      update: { enabled },
    });
  }
}
