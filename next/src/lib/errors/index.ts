export * from "./app-error"
export * from "./authentication-error"
export * from "./authorization-error"
export * from "./conflict-error"
export * from "./error-category"
export * from "./forbidden-error"
export * from "./http-status"
export * from "./internal-error"
export * from "./not-found-error"
export * from "./resource-error"
export * from "./unauthorized-error"
export * from "./validation-error"
export * from "./rate-limit-error"
export * from "./external-service-error"
export * from "./error-response"
export * from "./is-app-error"
export * from "./validation-failed-error"
export * from "./zod"
export * from "./validation-details"

// `ErrorHandler` (error-handler.ts) is deliberately NOT re-exported here. It
// transitively pulls in `node:async_hooks` (via `@/lib/logger`'s request
// context), and this barrel is reachable from client components (e.g.
// through `ApiResponse`/`HttpStatus` usage in pages). A Node-only module in
// a barrel a client component imports breaks the client bundle — see the
// identical precedent for `Route` in `lib/http/index.ts`. Import
// `ErrorHandler` directly from "@/lib/errors/error-handler" in server-only
// code instead.