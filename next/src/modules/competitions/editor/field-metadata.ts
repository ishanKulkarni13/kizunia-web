import type { EditableScalarKey } from "./build-update-payload";

/**
 * Admin-facing guidance tier, not a validation tier.
 *
 * - `critical`   — corresponds to a non-nullable column/schema field. Only
 *                  these can actually make a save fail on their own.
 * - `important`  — nullable, but something in the running product reads or
 *                  unconditionally renders it (see the per-field comment
 *                  below for the concrete code reference).
 * - `optional`   — nullable and read by nothing; missing it changes what a
 *                  visitor sees, never whether the competition works.
 *
 * This tiering is guidance for the Summary tab only. It must never be used
 * to block a save or a publish — see `CompetitionAction.PUBLISH`, which
 * exists in `backend/authorization/actions.ts` but is asserted nowhere, by
 * design.
 */
export type FieldImportance = "critical" | "important" | "optional";

/** Where in the editor this field is actually edited. */
export type EditorTab =
  | "general"
  | "schedule"
  | "locations"
  | "technologies"
  | "eligibility"
  | "documentation";

export type SummaryFieldKey =
  | EditableScalarKey
  | "logoAsset"
  | "technologies"
  | "eligibilities"
  | "locations";

export interface FieldMeta {
  key: SummaryFieldKey;
  label: string;
  tab: EditorTab;
  importance: FieldImportance;
  /** Whether "Not specified" (null / empty) is a valid, distinct state for
   * this field, as opposed to a field that always holds a real value once a
   * save has happened (e.g. `visibility`, `automaticStatusUpdatesDisabled`). */
  nullable: boolean;
}

/**
 * One row per field the Summary tab and the field-status system reason
 * about. Deliberately a flat data array, not a form-builder: nothing here
 * renders anything, and nothing here validates anything — it is read by
 * `summary-tab.tsx` (which section a field falls in) and by
 * `<EditorField>`/`SelectField` (whether to offer "Not specified").
 *
 * `field-metadata.test.ts` checks this list against `EDITABLE_SCALAR_KEYS`
 * and against `UpdateCompetitionSchema`'s nullability so the three cannot
 * silently drift apart.
 */
export const FIELD_METADATA: readonly FieldMeta[] = [
  // ---------------------------------------------------------------------
  // Critical — non-nullable in UpdateCompetitionSchema; the only fields
  // that can actually fail a save.
  // ---------------------------------------------------------------------
  { key: "title", label: "Title", tab: "general", importance: "critical", nullable: false },
  { key: "slug", label: "Slug", tab: "general", importance: "critical", nullable: false },
  { key: "visibility", label: "Visibility", tab: "general", importance: "critical", nullable: false },

  // ---------------------------------------------------------------------
  // Important — nullable, but unconditionally rendered or behaviorally
  // load-bearing somewhere in the running product today.
  // ---------------------------------------------------------------------
  {
    key: "shortDescription",
    label: "Short Description",
    tab: "general",
    importance: "important",
    nullable: true,
    // Shown in competition cards and search results — see the
    // `FieldDescription` copy in `create-compitition-form.tsx`.
  },
  {
    key: "organizer",
    label: "Organizer",
    tab: "general",
    importance: "important",
    nullable: true,
    // Rendered unconditionally under the title on the public page —
    // `(competition)/competitions/[slug]/page.tsx:121`.
  },
  {
    key: "logoAsset",
    label: "Logo",
    tab: "general",
    importance: "important",
    nullable: true,
    // Falls back to a title-initial avatar on the public page when absent
    // — not broken, but the primary visual identifier is missing.
  },
  {
    key: "content",
    label: "Documentation",
    tab: "documentation",
    importance: "important",
    nullable: true,
    // The public page's entire "About" section is gated on this.
  },
  {
    key: "startDate",
    label: "Start Date",
    tab: "schedule",
    importance: "important",
    nullable: true,
    // `resolveAutomaticStatus` (lifecycle/resolver.ts) cannot move a
    // competition out of an unknown/upcoming state without at least one
    // date; automation is inert without these four fields.
  },
  {
    key: "endDate",
    label: "End Date",
    tab: "schedule",
    importance: "important",
    nullable: true,
  },
  {
    key: "registrationDeadline",
    label: "Registration Deadline",
    tab: "schedule",
    importance: "important",
    nullable: true,
  },
  {
    key: "registrationStartDate",
    label: "Registration Opens",
    tab: "schedule",
    importance: "important",
    nullable: true,
  },

  // ---------------------------------------------------------------------
  // Optional — nullable, read by no code path. Missing these changes
  // presentation only, never whether the competition can save or publish.
  // ---------------------------------------------------------------------
  { key: "website", label: "Website", tab: "general", importance: "optional", nullable: true },
  { key: "registrationLink", label: "Registration Link", tab: "general", importance: "optional", nullable: true },
  { key: "mode", label: "Mode", tab: "general", importance: "optional", nullable: true },
  { key: "minTeamSize", label: "Min Team Size", tab: "general", importance: "optional", nullable: true },
  { key: "maxTeamSize", label: "Max Team Size", tab: "general", importance: "optional", nullable: true },
  { key: "certificateType", label: "Certificate", tab: "general", importance: "optional", nullable: true },
  { key: "prizePool", label: "Prize Pool", tab: "general", importance: "optional", nullable: true },
  { key: "registrationFee", label: "Registration Fee", tab: "general", importance: "optional", nullable: true },
  { key: "registrationFeeType", label: "Registration Fee Type", tab: "general", importance: "optional", nullable: true },
  { key: "registrationPlatform", label: "Registration Platform", tab: "general", importance: "optional", nullable: true },
  { key: "organizerType", label: "Organizer Type", tab: "general", importance: "optional", nullable: true },
  { key: "difficulty", label: "Difficulty", tab: "general", importance: "optional", nullable: true },
  { key: "technologies", label: "Technologies", tab: "technologies", importance: "optional", nullable: true },
  { key: "eligibilities", label: "Eligibility", tab: "eligibility", importance: "optional", nullable: true },
  { key: "locations", label: "Locations", tab: "locations", importance: "optional", nullable: true },

  // ---------------------------------------------------------------------
  // Lifecycle settings — surfaced by the Status section of the Summary and
  // the Schedule tab's own panel, not the missing-information list; listed
  // here only so every editable key has one metadata entry.
  // ---------------------------------------------------------------------
  { key: "status", label: "Status", tab: "general", importance: "optional", nullable: true },
  {
    key: "automaticStatusUpdatesDisabled",
    label: "Automatic Status Updates",
    tab: "schedule",
    importance: "optional",
    nullable: false,
  },
];

const FIELD_METADATA_BY_KEY: ReadonlyMap<SummaryFieldKey, FieldMeta> = new Map(
  FIELD_METADATA.map((meta) => [meta.key, meta]),
);

export function getFieldMeta(key: SummaryFieldKey): FieldMeta | undefined {
  return FIELD_METADATA_BY_KEY.get(key);
}

/**
 * DOM id for the field's scroll/focus target, used by the Summary tab's
 * "Not specified" links to jump to the right control. Most fields anchor
 * on their own key; `minTeamSize`/`maxTeamSize` share one control
 * (`TeamSizeField`) and so share one anchor.
 */
export function getFieldAnchorId(key: SummaryFieldKey): string {
  if (key === "minTeamSize" || key === "maxTeamSize") return "field-teamSize";
  return `field-${key}`;
}
