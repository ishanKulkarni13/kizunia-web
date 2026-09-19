interface PortfolioPublicAssetDto {
  id: string;

  url: string;

  width: number | null;

  height: number | null;

  format: string | null;

  mimeType: string | null;
}

/**
 * The Portfolio shape returned by the public `/portfolio/[username]` view.
 *
 * This is a deliberate public API contract, hand-mapped from the Prisma
 * entity — never a raw entity passthrough. Callers reaching this DTO have
 * already passed the repository's public lookup (PUBLIC, not deleted,
 * owner not banned, owner has a username), so every field here is
 * intentionally safe to expose to an anonymous third party. It is
 * deliberately richer than what the current frontend renders, since it is
 * also meant to support future third-party consumers rendering portfolios
 * on external sites (no API-key auth for that exists yet).
 */
export interface PortfolioPublicDto {
  id: string;

  displayName: string;

  headline: string | null;

  bio: string | null;

  // Intentional public presentation fields — independent of the User's
  // account email/phone. A builder may publish a different contact
  // address than their login email. See docs/architecture/domain/portfolio.md.
  publicContactEmail: string | null;

  phone: string | null;

  location: string | null;

  createdAt: string;

  user: {
    // Never null here — the public lookup requires a username to match.
    username: string;

    avatar: PortfolioPublicAssetDto | null;

    cover: PortfolioPublicAssetDto | null;
  };

  settings: {
    theme: string;

    accentColor: string;

    sectionOrder: string[];

    hiddenSections: string[];
  } | null;

  resumeAsset: PortfolioPublicAssetDto | null;

  links: {
    id: string;
    url: string;
    title: string;
    type: string;
    order: number;
  }[];

  technologies: {
    technology: {
      id: string;
      name: string;
      slug: string;
    };
    startedUsingAt: string | null;
    description: string | null;
    displayOrder: number;
  }[];

  education: {
    id: string;
    institution: string;
    degree: string | null;
    fieldOfStudy: string | null;
    grade: string | null;
    description: string | null;
    startDate: string | null;
    endDate: string | null;
    currentlyStudying: boolean;
    institutionLogo: PortfolioPublicAssetDto | null;
    displayOrder: number;
  }[];

  experience: {
    id: string;
    company: string;
    position: string;
    employmentType: string | null;
    location: string | null;
    description: string | null;
    startDate: string | null;
    endDate: string | null;
    currentlyWorking: boolean;
    companyLogo: PortfolioPublicAssetDto | null;
    displayOrder: number;
  }[];

  achievements: {
    id: string;
    title: string;
    description: string | null;
    achievedAt: string | null;
    asset: PortfolioPublicAssetDto | null;
    displayOrder: number;
  }[];

  certifications: {
    id: string;
    title: string;
    issuer: string;
    issueDate: string | null;
    expiryDate: string | null;
    credentialId: string | null;
    credentialUrl: string | null;
    asset: PortfolioPublicAssetDto | null;
    displayOrder: number;
  }[];

  // Portfolio-owned content — not a reference to another domain's
  // source-of-truth entity. See docs/architecture/domain/portfolio.md.
  testimonials: {
    id: string;
    name: string;
    position: string | null;
    company: string | null;
    message: string;
    rating: number | null;
    displayOrder: number;
    image: PortfolioPublicAssetDto | null;
  }[];

  // Small, purpose-built project reference shape — intentionally NOT the
  // full project public DTO (which carries members/permissions/statistics
  // that make no sense embedded in a portfolio card). Only projects whose
  // own visibility/status/deletion state make them eligible are ever
  // present here — enforced by the repository query, not this DTO.
  projects: {
    featured: boolean;
    displayOrder: number;
    project: {
      id: string;
      title: string;
      slug: string;
      shortDescription: string;
      logo: PortfolioPublicAssetDto | null;
      cover: PortfolioPublicAssetDto | null;
      technologies: {
        id: string;
        name: string;
        slug: string;
      }[];
      categories: {
        id: string;
        name: string;
        slug: string;
      }[];
    };
  }[];
}
