-- CreateTable
CREATE TABLE "public"."place_resolution" (
    "placeId" TEXT NOT NULL,
    "identityKeys" TEXT[],
    "displayName" TEXT,
    "contextLabel" TEXT,
    "extractionVersion" INTEGER NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "place_resolution_pkey" PRIMARY KEY ("placeId")
);

-- CreateTable
CREATE TABLE "public"."rate_limit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "place_resolution_resolvedAt_idx" ON "public"."place_resolution"("resolvedAt");

-- CreateIndex
CREATE INDEX "rate_limit_expiresAt_idx" ON "public"."rate_limit"("expiresAt");
