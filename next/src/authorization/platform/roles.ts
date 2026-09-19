export const PlatformRole = {
    USER: "user",
    ADMIN: "admin",
    SUPER_ADMIN: "superadmin",
    MODERATOR: "moderator",
} as const;

export type PlatformRole =
    (typeof PlatformRole)[keyof typeof PlatformRole];