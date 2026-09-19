import { AssetCategory, AssetPurpose } from "@/generated/prisma";

/**
 * Code-defined, per-purpose upload policy. This is the authority — the
 * frontend's `accept` attribute is a UX convenience only. See
 * docs/architecture/domain/assets/policies.md.
 *
 * Deliberately not a database table: nothing in the product requires
 * runtime-editable policies, and a table would be speculative
 * infrastructure for a fixed, code-reviewed rule set.
 */
export interface UploadPolicy {
  category: AssetCategory;
  allowedMimeTypes: readonly string[];
  /** Bytes. */
  maxSize: number;
  /** Whether this purpose expects exactly one active reference (a logo, a
   * resume) vs. many (a gallery). Informational for callers — Asset itself
   * has no opinion on ordering/count; the consuming domain owns that. */
  singleActive: boolean;
  /** Whether this purpose requires a target entity to be declared up front. */
  requiresTargetEntity: boolean;
  /**
   * Per-mime-type overrides of `category`/`maxSize`, for the rare policy that
   * accepts more than one Asset category under a single purpose (e.g. images
   * *and* a PDF in the same gallery). Absent for every ordinary single-
   * category policy, which just uses `category`/`maxSize` above for every
   * mime type it allows.
   */
  mimeTypeOverrides?: Record<string, { category: AssetCategory; maxSize: number }>;
}

const MB = 1024 * 1024;

/**
 * Numeric limits below are NOT decided anywhere in the architecture docs —
 * they are explicitly marked TBD there (see policies.md, security.md). These
 * values are a deliberately conservative V1 default, isolated here so they
 * can be changed in one place without touching any calling code. Treat them
 * as an assumption to confirm, not a settled product decision.
 */
const DEFAULT_IMAGE_MAX_SIZE = 5 * MB;
const DEFAULT_DOCUMENT_MAX_SIZE = 10 * MB;

const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * Portfolio resume is explicitly scoped to PDF only for V1 — see
 * docs/architecture/domain/assets/policies.md worked example. DOCX and other
 * document formats are intentionally not enabled unless a future product
 * decision adds them.
 */
const RESUME_MIME_TYPES = ["application/pdf"] as const;

function imagePolicy(overrides?: Partial<UploadPolicy>): UploadPolicy {
  return {
    category: AssetCategory.IMAGE,
    allowedMimeTypes: IMAGE_MIME_TYPES,
    maxSize: DEFAULT_IMAGE_MAX_SIZE,
    singleActive: true,
    requiresTargetEntity: true,
    ...overrides,
  };
}

export const UPLOAD_POLICIES: Record<AssetPurpose, UploadPolicy> = {
  [AssetPurpose.USER_AVATAR]: imagePolicy({ requiresTargetEntity: false }),
  [AssetPurpose.USER_COVER]: imagePolicy({ requiresTargetEntity: false }),

  [AssetPurpose.PROJECT_LOGO]: imagePolicy(),
  [AssetPurpose.PROJECT_COVER]: imagePolicy(),

  [AssetPurpose.COMPETITION_LOGO]: imagePolicy(),
  [AssetPurpose.COMPETITION_BANNER]: imagePolicy(),
  [AssetPurpose.COMPETITION_COVER]: imagePolicy(),

  // V1: extended to also accept a single supporting PDF alongside the
  // gallery images. This is the one isolated place that grants PDF support
  // for this purpose — `allowedMimeTypes`/`mimeTypeOverrides` below — so
  // removing it later is a one-entry revert; it does not touch PDF
  // configuration for any other purpose (see PORTFOLIO_RESUME above).
  [AssetPurpose.COMPETITION_SUGGESTION_GALLERY]: imagePolicy({
    singleActive: false,
    allowedMimeTypes: [...IMAGE_MIME_TYPES, ...RESUME_MIME_TYPES],
    mimeTypeOverrides: {
      "application/pdf": {
        category: AssetCategory.DOCUMENT,
        maxSize: DEFAULT_DOCUMENT_MAX_SIZE,
      },
    },
  }),

  [AssetPurpose.PORTFOLIO_RESUME]: {
    category: AssetCategory.DOCUMENT,
    allowedMimeTypes: RESUME_MIME_TYPES,
    maxSize: DEFAULT_DOCUMENT_MAX_SIZE,
    singleActive: true,
    requiresTargetEntity: false,
  },

  [AssetPurpose.PORTFOLIO_EDUCATION_LOGO]: imagePolicy(),
  [AssetPurpose.PORTFOLIO_EXPERIENCE_LOGO]: imagePolicy(),
  [AssetPurpose.PORTFOLIO_ACHIEVEMENT_ASSET]: imagePolicy(),
  [AssetPurpose.PORTFOLIO_CERTIFICATION_ASSET]: imagePolicy(),

  // @deprecated Superseded by PROJECT_TESTIMONIAL_IMAGE /
  // PORTFOLIO_TESTIMONIAL_IMAGE. Entry kept only because UPLOAD_POLICIES
  // must cover every AssetPurpose enum member; never issued by application
  // code going forward.
  [AssetPurpose.TESTIMONIAL_IMAGE]: imagePolicy(),
  [AssetPurpose.PROJECT_TESTIMONIAL_IMAGE]: imagePolicy(),
  [AssetPurpose.PORTFOLIO_TESTIMONIAL_IMAGE]: imagePolicy(),
  [AssetPurpose.BADGE_ICON]: imagePolicy({ requiresTargetEntity: false }),

  // Global taxonomy entity, no per-instance owner at intent-creation time —
  // same shape as BADGE_ICON.
  [AssetPurpose.TECHNOLOGY_ICON]: imagePolicy({ requiresTargetEntity: false }),
};

export function getUploadPolicy(purpose: AssetPurpose): UploadPolicy {
  return UPLOAD_POLICIES[purpose];
}

/** The AssetCategory a given mime type resolves to under `policy`. */
export function resolveUploadCategory(
  policy: UploadPolicy,
  mimeType: string,
): AssetCategory {
  return policy.mimeTypeOverrides?.[mimeType]?.category ?? policy.category;
}

/**
 * Every AssetCategory this policy can ever produce, across its base category
 * and any `mimeTypeOverrides`. Used to validate an already-persisted Asset
 * against a purpose without re-deriving the category from `Asset.mimeType`
 * (nullable per schema, and not guaranteed to survive round-tripping through
 * every storage provider/resource type — e.g. a provider that doesn't
 * reliably report format for a given category). `Asset.category` is set once
 * from the policy-resolved category at upload-intent creation time and is
 * the authoritative field for this check.
 */
export function resolveAllowedCategories(
  policy: UploadPolicy,
): AssetCategory[] {
  const categories = new Set<AssetCategory>([policy.category]);

  for (const override of Object.values(policy.mimeTypeOverrides ?? {})) {
    categories.add(override.category);
  }

  return [...categories];
}

/** The max byte size a given mime type is held to under `policy`. */
export function resolveUploadMaxSize(
  policy: UploadPolicy,
  mimeType: string,
): number {
  return policy.mimeTypeOverrides?.[mimeType]?.maxSize ?? policy.maxSize;
}
