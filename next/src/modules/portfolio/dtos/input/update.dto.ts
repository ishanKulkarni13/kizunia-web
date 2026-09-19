export interface UpdatePortfolioProfileDto {
  displayName?: string;
  headline?: string | null;
  bio?: string | null;
  phone?: string | null;
  publicContactEmail?: string | null;
  location?: string | null;
  resumeAssetId?: string | null;
}