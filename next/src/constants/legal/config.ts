export const legalConfig = {
  entityName: "Not yet configured",
  entityAddress: "Not yet configured",
  legalContactEmail: "Not yet configured",
  privacyContactEmail: "Not yet configured",
  governingLaw: "Not yet configured",
  jurisdiction: "Not yet configured",
  lastUpdatedDate: "2026-09-10",
  lastUpdated: "September 10, 2026",
} as const;

export const legalContact = {
  legal: legalConfig.legalContactEmail,
  privacy: legalConfig.privacyContactEmail,
} as const;
