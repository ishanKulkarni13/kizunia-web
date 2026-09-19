/**
 * Users Module — Constants
 */

import { PlatformRole } from "@/authorization";

export const USER_ROLES = PlatformRole

export const USER_LIMITS = {
  MAX_NAME_LENGTH: 100,
  MAX_BIO_LENGTH: 500,
  MAX_USERNAME_LENGTH: 30,
} as const;
