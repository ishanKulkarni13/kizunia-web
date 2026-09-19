# Better Auth

## Status

Accepted

---

# Context

Kizunia requires an authentication solution that supports modern authentication methods while remaining flexible enough for future growth.

The platform requires:

- Email and OAuth authentication
- Session management
- Email verification
- Prisma integration
- Platform administrators
- Extensibility for future features

---

# Decision

Kizunia will use **Better Auth** as its authentication library.

The following plugins will be used:

- Better Auth Core
- Better Auth Prisma Adapter
- Better Auth Admin Plugin

The Organization Plugin will **not** be used.

---

# Rationale

Better Auth provides a modern authentication system that integrates well with Prisma while allowing Kizunia to own its domain models.

Authentication and platform administration are delegated to Better Auth.

Application-specific authorization remains the responsibility of Kizunia.

---

# Platform Roles

Better Auth manages only platform roles.

Examples include:

- USER
- ADMIN
- SUPER_ADMIN

Project roles, Team roles and other resource permissions are managed separately by Kizunia.

---

# Consequences

## Advantages

- Mature authentication solution.
- Reduced maintenance.
- Modern authentication features.
- Future support for Passkeys and MFA.

## Trade-offs

- Better Auth becomes a core dependency.
- Application authorization must still be implemented separately.