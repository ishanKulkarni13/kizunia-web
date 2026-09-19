-- CreateTable
CREATE TABLE "public"."oauth_application" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "metadata" TEXT,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "redirectUrls" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "disabled" BOOLEAN DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."oauth_access_token" (
    "id" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "scopes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_access_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."oauth_consent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "consentGiven" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_application_clientId_key" ON "public"."oauth_application"("clientId");

-- CreateIndex
CREATE INDEX "oauth_application_userId_idx" ON "public"."oauth_application"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_access_token_accessToken_key" ON "public"."oauth_access_token"("accessToken");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_access_token_refreshToken_key" ON "public"."oauth_access_token"("refreshToken");

-- CreateIndex
CREATE INDEX "oauth_access_token_clientId_idx" ON "public"."oauth_access_token"("clientId");

-- CreateIndex
CREATE INDEX "oauth_access_token_userId_idx" ON "public"."oauth_access_token"("userId");

-- CreateIndex
CREATE INDEX "oauth_consent_clientId_idx" ON "public"."oauth_consent"("clientId");

-- CreateIndex
CREATE INDEX "oauth_consent_userId_idx" ON "public"."oauth_consent"("userId");

-- AddForeignKey
ALTER TABLE "public"."oauth_application" ADD CONSTRAINT "oauth_application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_access_token" ADD CONSTRAINT "oauth_access_token_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_application"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_access_token" ADD CONSTRAINT "oauth_access_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_consent" ADD CONSTRAINT "oauth_consent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."oauth_application"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_consent" ADD CONSTRAINT "oauth_consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
