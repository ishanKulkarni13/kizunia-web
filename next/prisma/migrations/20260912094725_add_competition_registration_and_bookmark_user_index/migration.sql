-- CreateTable
CREATE TABLE "public"."competition_registration" (
    "competitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competition_registration_pkey" PRIMARY KEY ("competitionId","userId")
);

-- CreateIndex
CREATE INDEX "competition_registration_userId_markedAt_idx" ON "public"."competition_registration"("userId", "markedAt" DESC);

-- CreateIndex
CREATE INDEX "competition_bookmark_userId_createdAt_idx" ON "public"."competition_bookmark"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "public"."competition_registration" ADD CONSTRAINT "competition_registration_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."competition_registration" ADD CONSTRAINT "competition_registration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
