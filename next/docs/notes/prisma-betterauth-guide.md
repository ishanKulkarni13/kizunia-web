# Prisma & Better-Auth – Project Notes

> **Project stack:** Prisma `6.14.0` · better-auth `^1.3.9` · Next.js 16 · pnpm

---

## ⚠️ Golden Rule: Never Use `pnpm dlx prisma`

`pnpm dlx` downloads and runs the **latest** Prisma from npm (currently v7.x), which is a breaking version.
Always use the **locally installed** CLI instead.

| ❌ Wrong (downloads v7) | ✅ Correct (uses local v6) |
|---|---|
| `pnpm dlx prisma generate` | `pnpm prisma generate` |
| `pnpm dlx prisma migrate dev` | `pnpm prisma migrate dev` |
| `pnpm dlx prisma studio` | `pnpm prisma studio` |

---

## 🛠️ Common Commands

### Open Prisma Studio
```bash
pnpm prisma studio
```
Opens a visual DB browser at `http://localhost:5555`.

### Generate Prisma Client
Run this after any schema change:
```bash
pnpm prisma generate
```
Output goes to `./src/generated/prisma` (configured in `schema.prisma`).

### Create & Apply a Migration
Run in your **own interactive terminal** (not via a script — Prisma requires interactive mode for `migrate dev`):
```bash
pnpm prisma migrate dev --name <descriptive-name>
```
Examples:
```bash
pnpm prisma migrate dev --name add-username-plugin
pnpm prisma migrate dev --name add-posts-table
```
> Prisma will warn about destructive changes (e.g. adding unique constraints) and ask for confirmation — that's why it needs an interactive terminal.

---

## 🔌 Adding a Better-Auth Plugin

### 1. Add the plugin to `auth.ts`
```ts
// src/lib/auth.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, username } from "better-auth/plugins"; // ← import plugin
import prisma from "./prisma";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  plugins: [
    admin(),
    username(), // ← add plugin here
  ],
  emailAndPassword: { enabled: true },
});
```

### 2. Regenerate the Prisma schema
The better-auth CLI generates the schema fields the plugin needs:
```bash
pnpm dlx @better-auth/cli generate
```
> Note: `@better-auth/cli` is a separate package — use `dlx` for this one since it's just a code generator tool, not a Prisma command.

When prompted `overwrite schema.prisma? (y/N)` → type `y`.

### 3. Migrate the database
```bash
pnpm prisma migrate dev --name add-<plugin-name>
```

### 4. Regenerate the Prisma client
```bash
pnpm prisma generate
```

---

## 📁 Key File Locations

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | DB schema — models, relations, datasource |
| `prisma.config.ts` | Prisma config (datasource URL for CLI) |
| `src/generated/prisma/` | Auto-generated Prisma client — **don't edit** |
| `src/lib/prisma.ts` | Singleton Prisma client for app use |
| `src/lib/auth.ts` | Better-auth server config (plugins, adapter) |
| `src/lib/auth-client.ts` | Better-auth client (React hooks like `useSession`) |

---

## 🏗️ Schema Rules (Prisma v6)

- The `datasource` block **must** have a `url` field in `schema.prisma`:
  ```prisma
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }
  ```
- The `output` in the generator block must point to `../src/generated/prisma`:
  ```prisma
  generator client {
    provider = "prisma-client-js"
    output   = "../src/generated/prisma"
  }
  ```
- Import the client from the output path:
  ```ts
  import { PrismaClient } from "@/generated/prisma";
  ```

> In Prisma v7 (which you are **not** using), `url` moved out of the schema into `prisma.config.ts`. Don't follow v7 docs.

---

## 🔄 Typical Plugin Addition Workflow (Full)

```
1. Edit src/lib/auth.ts                              → import & add plugin
2. pnpm dlx @better-auth/cli generate                → updates schema.prisma
3. pnpm prisma migrate dev --name <name>             → run in interactive terminal
4. pnpm prisma generate                              → rebuilds client types
```

---

## 💡 Tips

- **`prisma.config.ts`** — Do **NOT** add a `datasource` property to this file on Prisma 6. The `datasource` field is a Prisma 7-only type and will cause `next build` to fail with: `'datasource' does not exist in type 'PrismaConfig'`. The DB URL is already in `schema.prisma` via `url = env("DATABASE_URL")`.
- **Prisma Studio** sometimes doesn't reflect schema changes until you run `pnpm prisma generate`.
- **`pnpm dev`** hot-reloads code but does **not** re-generate Prisma types — always run `pnpm prisma generate` manually after schema changes.
- The `username` plugin adds `username` and `displayUsername` columns to the `user` table.
- **Export style matters:** `src/lib/prisma.ts` uses `export default prisma` — import it as `import prisma from "./prisma"`, not `import { prisma }`.

