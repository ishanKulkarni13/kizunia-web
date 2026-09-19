export * from "./mine-dto";
export * from "./mine-schema";

// Note: `./ui`, `./layout` and `./definition` are not re-exported here.
// `./ui` is the client-safe spec module and must be imported directly by
// client components (mirrors Competitions' `search/ui.ts` boundary); `./layout`
// and `./definition` are server-only and imported directly where needed
// (the controller/service for `./definition`, the discovery page for
// `./layout`) to keep this barrel's own import graph client-safe.
