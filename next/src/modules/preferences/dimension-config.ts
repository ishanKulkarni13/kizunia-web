/**
 * Competition preference dimensions — client-safe display config.
 *
 * One place that maps each of the engine's 13 `DimensionId`s to how the
 * preferences UI should let a user pick a value for it: a label, a short
 * description, and its control kind.
 *
 * Enum-backed dimensions reuse the `{value, label}` option lists already
 * defined for the competition search filters
 * (`@/modules/competitions/search/ui`) instead of re-typing the same product
 * copy a second time. That module is documented as safe to import from a
 * `"use client"` component (it never imports `@/generated/prisma`), so this
 * file inherits that same safety.
 */
import { competitionFilterSpecs } from "@/modules/competitions/search/ui";
import { DimensionId } from "@/modules/recommendations";

export interface DimensionOption {
  readonly value: string;
  readonly label: string;
}

export type DimensionControl =
  | { readonly kind: "enum"; readonly options: readonly DimensionOption[] }
  | { readonly kind: "categories" }
  | { readonly kind: "technologies" }
  | { readonly kind: "location" }
  | { readonly kind: "team-size" };

export interface DimensionDefinition {
  readonly id: DimensionId;
  readonly label: string;
  readonly description: string;
  readonly control: DimensionControl;
}

function enumControl(spec: {
  readonly options: readonly { readonly value: string; readonly label: string }[];
}): DimensionControl {
  return {
    kind: "enum",
    options: spec.options.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  };
}

export const DIMENSION_DEFINITIONS: readonly DimensionDefinition[] = [
  {
    id: DimensionId.MODE,
    label: "Mode",
    description: "Online, in person, or hybrid.",
    control: enumControl(competitionFilterSpecs.modes),
  },
  {
    id: DimensionId.CATEGORIES,
    label: "Categories",
    description: "The themes a competition is about.",
    control: { kind: "categories" },
  },
  {
    id: DimensionId.TECHNOLOGIES,
    label: "Technologies",
    description: "Tools and stacks a competition is built around.",
    control: { kind: "technologies" },
  },
  {
    id: DimensionId.ELIGIBILITIES,
    label: "Eligibility",
    description: "Who you are, so we can match competitions open to you.",
    control: enumControl(competitionFilterSpecs.eligibilities),
  },
  {
    id: DimensionId.LOCATION,
    label: "Location",
    description: "Places you'd travel to for an in-person competition.",
    control: { kind: "location" },
  },
  {
    id: DimensionId.REGISTRATION_PLATFORM,
    label: "Hosted on",
    description: "The platform registration happens through.",
    control: enumControl(competitionFilterSpecs.registrationPlatforms),
  },
  {
    id: DimensionId.REGISTRATION_TYPE,
    label: "Entry format",
    description: "Solo, team, or either.",
    control: enumControl(competitionFilterSpecs.registrationTypes),
  },
  {
    id: DimensionId.REGISTRATION_FEE_TYPE,
    label: "Entry fee",
    description: "Free, paid, or conditional.",
    control: enumControl(competitionFilterSpecs.registrationFeeTypes),
  },
  {
    id: DimensionId.ORGANIZER_TYPE,
    label: "Organizer type",
    description: "Who typically runs the competition.",
    control: enumControl(competitionFilterSpecs.organizerTypes),
  },
  {
    id: DimensionId.DIFFICULTY,
    label: "Difficulty",
    description: "How advanced the competition is.",
    control: enumControl(competitionFilterSpecs.difficultyLevels),
  },
  {
    id: DimensionId.CERTIFICATE_TYPE,
    label: "Certificate",
    description: "Whether a certificate is offered, and for what.",
    control: enumControl(competitionFilterSpecs.certificateTypes),
  },
  {
    id: DimensionId.STATUS,
    label: "Stage",
    description: "Where a competition is in its lifecycle.",
    control: enumControl(competitionFilterSpecs.statuses),
  },
  {
    id: DimensionId.TEAM_SIZE,
    label: "Team size",
    description: "Team sizes you'd want to enter with.",
    control: { kind: "team-size" },
  },
];
