-- CreateEnum
CREATE TYPE "public"."CompetitionType" AS ENUM ('HACKATHON', 'IDEATHON', 'QUIZ', 'DSA', 'COMPETITIVE_PROGRAMMING', 'CASE_STUDY', 'BUSINESS_PLAN', 'PITCHING', 'UI_UX', 'CTF', 'ROBOTICS', 'GAMING', 'DEBATE', 'WRITING', 'OTHER');

-- CreateTable
CREATE TABLE "public"."competition_type" (
    "competitionId" TEXT NOT NULL,
    "type" "public"."CompetitionType" NOT NULL,

    CONSTRAINT "competition_type_pkey" PRIMARY KEY ("competitionId","type")
);

-- CreateIndex
CREATE INDEX "competition_type_type_idx" ON "public"."competition_type"("type");

-- AddForeignKey
ALTER TABLE "public"."competition_type" ADD CONSTRAINT "competition_type_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "public"."competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
