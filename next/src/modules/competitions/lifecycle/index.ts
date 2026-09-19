/**
 * Competitions Module - Lifecycle
 *
 * Barrel for the pure lifecycle resolver. Deliberately outside `backend/`:
 * unlike everything under that folder, this has no Prisma import and no
 * server-only dependency, so nothing stops a future client surface (e.g. a
 * live preview in the editor) from importing it directly.
 */

export {
  resolveAutomaticStatus,
  evaluateLifecycle,
  LifecycleReason,
  type LifecycleInput,
  type LifecycleResolution,
  type LifecycleEvaluation,
} from "./resolver";
