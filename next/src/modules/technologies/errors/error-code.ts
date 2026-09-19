export const TechnologyErrorCode = {
    NOT_FOUND: "TECHNOLOGY_NOT_FOUND",

    DUPLICATE_NAME: "TECHNOLOGY_DUPLICATE_NAME",

    DUPLICATE_SLUG: "TECHNOLOGY_DUPLICATE_SLUG",
} as const;

export type TechnologyErrorCode =
    (typeof TechnologyErrorCode)[keyof typeof TechnologyErrorCode];
