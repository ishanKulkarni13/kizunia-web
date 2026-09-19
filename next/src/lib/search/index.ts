/**
 * Search Core - Server entry point
 *
 * Re-exports the whole subsystem: the client-safe half (specs, values, URL
 * parameters, layout) plus the query-building half (engine, composition,
 * scopes, sorting, filter factories).
 *
 * Client components must import from `@/lib/search/client` instead — see the
 * boundary note in that file.
 */

export * from "./spec";
export * from "./spec-values";
export * from "./params";
export * from "./layout";
export * from "./presets";
export * from "./preset-storage";

export * from "./types";
export * from "./compose";
export * from "./guards";
export * from "./bind";
export * from "./resolve";
export * from "./scope";
export * from "./sort";
export * from "./pagination";
export * from "./engine";
export * from "./filters";
