-- CreateEnum
CREATE TYPE "public"."UserVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "public"."UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "public"."SuggestionStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "public"."CompetitionMode" AS ENUM ('ONLINE', 'OFFLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "public"."CompetitionVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "public"."CompetitionStatus" AS ENUM ('UPCOMING', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."CompetitionMemberRole" AS ENUM ('OWNER', 'ORGANIZER', 'MAINTAINER');

-- CreateEnum
CREATE TYPE "public"."RegistrationPlatform" AS ENUM ('KIZUNIA', 'UNSTOP', 'DEVPOST', 'DEVFOLIO', 'DORAHACKS', 'HACK2SKILL', 'HACKEREARTH', 'TAIKAI', 'LUMA', 'GOOGLE_FORM', 'TYPEFORM', 'CUSTOM', 'OFFLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."RegistrationType" AS ENUM ('INDIVIDUAL', 'TEAM', 'BOTH');

-- CreateEnum
CREATE TYPE "public"."RegistrationFeeType" AS ENUM ('FREE', 'PAID', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "public"."OrganizerType" AS ENUM ('COLLEGE', 'COMPANY', 'COMMUNITY', 'GOVERNMENT', 'NON_PROFIT', 'STARTUP', 'INDIVIDUAL', 'OPEN_SOURCE');

-- CreateEnum
CREATE TYPE "public"."DifficultyLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'OPEN');

-- CreateEnum
CREATE TYPE "public"."CertificateType" AS ENUM ('NONE', 'PARTICIPATION', 'WINNER');

-- CreateEnum
CREATE TYPE "public"."EligibilityType" AS ENUM ('SCHOOL', 'UNDERGRADUATE', 'POSTGRADUATE', 'PHD', 'FRESHER', 'PROFESSIONAL', 'ENGINEERING', 'MANAGEMENT', 'DESIGN', 'SCIENCE', 'COMMERCE', 'ARTS', 'MEDICAL', 'LAW', 'OPEN', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."ProjectVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "public"."ProjectStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "public"."ProjectRole" AS ENUM ('OWNER', 'MAINTAINER', 'CONTRIBUTOR');

-- CreateEnum
CREATE TYPE "public"."AssetProvider" AS ENUM ('CLOUDINARY');

-- CreateEnum
CREATE TYPE "public"."LinkType" AS ENUM ('WEBSITE', 'REGISTRATION', 'GITHUB', 'GITLAB', 'DEMO', 'DOCUMENTATION', 'FIGMA', 'DEVPOST', 'DEVFOLIO', 'UNSTOP', 'LINKEDIN', 'TWITTER', 'INSTAGRAM', 'DISCORD', 'YOUTUBE', 'PORTFOLIO', 'OTHER');

-- CreateTable
CREATE TABLE "public"."user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT,
    "banned" BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "username" TEXT,
    "displayUsername" TEXT,
    "headline" TEXT,
    "bio" TEXT,
    "college" TEXT,
    "degree" TEXT,
    "graduationYear" INTEGER,
    "location" TEXT,
    "avatarAssetId" TEXT,
    "coverAssetId" TEXT,
    "visibility" "public"."UserVisibility" NOT NULL DEFAULT 'PUBLIC',
    "status" "public"."UserStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "impersonatedBy" TEXT,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."link" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "public"."LinkType" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "userId" TEXT,
    "competitionId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "competitionSuggestionId" TEXT,

    CONSTRAINT "link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."asset" (
    "id" TEXT NOT NULL,
    "provider" "public"."AssetProvider" NOT NULL,
    "publicId" TEXT NOT NULL,
    "secureUrl" TEXT NOT NULL,
    "format" TEXT,
    "mimeType" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "checksum" TEXT,
    "originalFilename" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."technology" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "iconUrl" TEXT,
    "description" TEXT,

    CONSTRAINT "technology_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."badge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "iconUrl" TEXT,

    CONSTRAINT "badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."user_technology" (
    "userId" TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,

    CONSTRAINT "user_technology_pkey" PRIMARY KEY ("userId","technologyId")
);

-- CreateTable
CREATE TABLE "public"."user_category" (
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "user_category_pkey" PRIMARY KEY ("userId","categoryId")
);

-- CreateTable
CREATE TABLE "public"."user_badge" (
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_badge_pkey" PRIMARY KEY ("userId","badgeId")
);

-- CreateTable
CREATE TABLE "public"."notification_preference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "pushNotifications" BOOLEAN NOT NULL DEFAULT false,
    "preferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."competition" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "shortDescription" TEXT,
    "organizer" TEXT,
    "mode" "public"."CompetitionMode",
    "location" TEXT,
    "minTeamSize" INTEGER,
    "maxTeamSize" INTEGER,
    "registrationLink" TEXT,
    "website" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "registrationDeadline" TIMESTAMP(3),
    "prizePool" TEXT,
    "logoAssetId" TEXT,
    "bannerAssetId" TEXT,
    "coverAssetId" TEXT,
    "contentId" TEXT,
    "visibility" "public"."CompetitionVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "public"."CompetitionStatus",
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "registrationPlatform" "public"."RegistrationPlatform",
    "registrationType" "public"."RegistrationType",
    "registrationFeeType" "public"."RegistrationFeeType",
    "registrationFee" TEXT,
    "organizerType" "public"."OrganizerType",
    "difficulty" "public"."DifficultyLevel",
    "certificateType" "public"."CertificateType",

    CONSTRAINT "competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."competition_suggestion" (
    "id" TEXT NOT NULL,
    "status" "public"."SuggestionStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "rejectionReason" TEXT,
    "competitionId" TEXT,
    "submittedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "title" TEXT,
    "shortDescription" TEXT,
    "organizer" TEXT,
    "mode" "public"."CompetitionMode",
    "location" TEXT,
    "registrationLink" TEXT,
    "website" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "registrationDeadline" TIMESTAMP(3),
    "minTeamSize" INTEGER,
    "maxTeamSize" INTEGER,
    "prizePool" TEXT,
    "documentation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "logoAssetId" TEXT,
    "bannerAssetId" TEXT,
    "coverAssetId" TEXT,

    CONSTRAINT "competition_suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."competition_member" (
    "competitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."CompetitionMemberRole" NOT NULL DEFAULT 'MAINTAINER',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_member_pkey" PRIMARY KEY ("competitionId","userId")
);

-- CreateTable
CREATE TABLE "public"."competition_category" (
    "competitionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "competition_category_pkey" PRIMARY KEY ("competitionId","categoryId")
);

-- CreateTable
CREATE TABLE "public"."competition_technology" (
    "competitionId" TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,

    CONSTRAINT "competition_technology_pkey" PRIMARY KEY ("competitionId","technologyId")
);

-- CreateTable
CREATE TABLE "public"."competition_eligibility" (
    "competitionId" TEXT NOT NULL,
    "type" "public"."EligibilityType" NOT NULL,

    CONSTRAINT "competition_eligibility_pkey" PRIMARY KEY ("competitionId","type")
);

-- CreateTable
CREATE TABLE "public"."competition_bookmark" (
    "competitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_bookmark_pkey" PRIMARY KEY ("competitionId","userId")
);

-- CreateTable
CREATE TABLE "public"."competition_suggestion_category" (
    "suggestionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "competition_suggestion_category_pkey" PRIMARY KEY ("suggestionId","categoryId")
);

-- CreateTable
CREATE TABLE "public"."competition_suggestion_technology" (
    "suggestionId" TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,

    CONSTRAINT "competition_suggestion_technology_pkey" PRIMARY KEY ("suggestionId","technologyId")
);

-- CreateTable
CREATE TABLE "public"."project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "shortDescription" TEXT NOT NULL,
    "contentId" TEXT,
    "visibility" "public"."ProjectVisibility" NOT NULL DEFAULT 'PUBLIC',
    "status" "public"."ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "logoAssetId" TEXT,
    "coverAssetId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."project_member" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "public"."ProjectRole" NOT NULL DEFAULT 'CONTRIBUTOR',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_member_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "public"."project_category" (
    "projectId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "project_category_pkey" PRIMARY KEY ("projectId","categoryId")
);

-- CreateTable
CREATE TABLE "public"."project_technology" (
    "projectId" TEXT NOT NULL,
    "technologyId" TEXT NOT NULL,

    CONSTRAINT "project_technology_pkey" PRIMARY KEY ("projectId","technologyId")
);

-- CreateTable
CREATE TABLE "public"."project_badge" (
    "projectId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_badge_pkey" PRIMARY KEY ("projectId","badgeId")
);

-- CreateTable
CREATE TABLE "public"."competition_project" (
    "competitionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_project_pkey" PRIMARY KEY ("competitionId","projectId")
);

-- CreateTable
CREATE TABLE "public"."Content" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "public"."user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "public"."user"("username");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "public"."session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "public"."session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "public"."account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "public"."verification"("identifier");

-- CreateIndex
CREATE INDEX "link_userId_idx" ON "public"."link"("userId");

-- CreateIndex
CREATE INDEX "link_competitionId_idx" ON "public"."link"("competitionId");

-- CreateIndex
CREATE INDEX "link_projectId_idx" ON "public"."link"("projectId");

-- CreateIndex
CREATE INDEX "link_competitionSuggestionId_idx" ON "public"."link"("competitionSuggestionId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_publicId_key" ON "public"."asset"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "technology_name_key" ON "public"."technology"("name");

-- CreateIndex
CREATE UNIQUE INDEX "technology_slug_key" ON "public"."technology"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "category_name_key" ON "public"."category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "category_slug_key" ON "public"."category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "badge_name_key" ON "public"."badge"("name");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preference_userId_key" ON "public"."notification_preference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "competition_slug_key" ON "public"."competition"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "competition_contentId_key" ON "public"."competition"("contentId");

-- CreateIndex
CREATE INDEX "competition_status_idx" ON "public"."competition"("status");

-- CreateIndex
CREATE INDEX "competition_visibility_idx" ON "public"."competition"("visibility");

-- CreateIndex
CREATE INDEX "competition_deletedAt_idx" ON "public"."competition"("deletedAt");

-- CreateIndex
CREATE INDEX "competition_startDate_idx" ON "public"."competition"("startDate");

-- CreateIndex
CREATE INDEX "competition_registrationDeadline_idx" ON "public"."competition"("registrationDeadline");

-- CreateIndex
CREATE INDEX "competition_createdById_idx" ON "public"."competition"("createdById");

-- CreateIndex
CREATE INDEX "competition_updatedById_idx" ON "public"."competition"("updatedById");

-- CreateIndex
CREATE INDEX "competition_suggestion_status_idx" ON "public"."competition_suggestion"("status");

-- CreateIndex
CREATE INDEX "competition_suggestion_submittedById_idx" ON "public"."competition_suggestion"("submittedById");

-- CreateIndex
CREATE INDEX "competition_suggestion_reviewedById_idx" ON "public"."competition_suggestion"("reviewedById");

-- CreateIndex
CREATE INDEX "competition_suggestion_competitionId_idx" ON "public"."competition_suggestion"("competitionId");

-- CreateIndex
CREATE INDEX "competition_suggestion_createdAt_idx" ON "public"."competition_suggestion"("createdAt");

-- CreateIndex
CREATE INDEX "competition_eligibility_type_idx" ON "public"."competition_eligibility"("type");

-- CreateIndex
CREATE UNIQUE INDEX "project_slug_key" ON "public"."project"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "project_contentId_key" ON "public"."project"("contentId");

-- AddForeignKey
ALTER TABLE "public"."user" ADD CONSTRAINT "user_avatarAssetId_fkey" FOREIGN KEY ("avatarAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user" ADD CONSTRAINT "user_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."link" ADD CONSTRAINT "link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."link" ADD CONSTRAINT "link_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."link" ADD CONSTRAINT "link_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."link" ADD CONSTRAINT "link_competitionSuggestionId_fkey" FOREIGN KEY ("competitionSuggestionId") REFERENCES "public"."competition_suggestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_technology" ADD CONSTRAINT "user_technology_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_technology" ADD CONSTRAINT "user_technology_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "public"."technology"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_category" ADD CONSTRAINT "user_category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_category" ADD CONSTRAINT "user_category_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_badge" ADD CONSTRAINT "user_badge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."user_badge" ADD CONSTRAINT "user_badge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "public"."badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notification_preference" ADD CONSTRAINT "notification_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition" ADD CONSTRAINT "competition_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition" ADD CONSTRAINT "competition_bannerAssetId_fkey" FOREIGN KEY ("bannerAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition" ADD CONSTRAINT "competition_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition" ADD CONSTRAINT "competition_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "public"."Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition" ADD CONSTRAINT "competition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition" ADD CONSTRAINT "competition_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion" ADD CONSTRAINT "competition_suggestion_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion" ADD CONSTRAINT "competition_suggestion_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion" ADD CONSTRAINT "competition_suggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion" ADD CONSTRAINT "competition_suggestion_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion" ADD CONSTRAINT "competition_suggestion_bannerAssetId_fkey" FOREIGN KEY ("bannerAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion" ADD CONSTRAINT "competition_suggestion_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_member" ADD CONSTRAINT "competition_member_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_member" ADD CONSTRAINT "competition_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_category" ADD CONSTRAINT "competition_category_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_category" ADD CONSTRAINT "competition_category_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_technology" ADD CONSTRAINT "competition_technology_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_technology" ADD CONSTRAINT "competition_technology_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "public"."technology"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_eligibility" ADD CONSTRAINT "competition_eligibility_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_bookmark" ADD CONSTRAINT "competition_bookmark_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_bookmark" ADD CONSTRAINT "competition_bookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion_category" ADD CONSTRAINT "competition_suggestion_category_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "public"."competition_suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion_category" ADD CONSTRAINT "competition_suggestion_category_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion_technology" ADD CONSTRAINT "competition_suggestion_technology_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "public"."competition_suggestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_suggestion_technology" ADD CONSTRAINT "competition_suggestion_technology_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "public"."technology"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project" ADD CONSTRAINT "project_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "public"."Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project" ADD CONSTRAINT "project_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project" ADD CONSTRAINT "project_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "public"."asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project" ADD CONSTRAINT "project_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project" ADD CONSTRAINT "project_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "public"."user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_member" ADD CONSTRAINT "project_member_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_member" ADD CONSTRAINT "project_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_category" ADD CONSTRAINT "project_category_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_category" ADD CONSTRAINT "project_category_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_technology" ADD CONSTRAINT "project_technology_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_technology" ADD CONSTRAINT "project_technology_technologyId_fkey" FOREIGN KEY ("technologyId") REFERENCES "public"."technology"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_badge" ADD CONSTRAINT "project_badge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."project_badge" ADD CONSTRAINT "project_badge_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "public"."badge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_project" ADD CONSTRAINT "competition_project_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_project" ADD CONSTRAINT "competition_project_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "public"."project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
