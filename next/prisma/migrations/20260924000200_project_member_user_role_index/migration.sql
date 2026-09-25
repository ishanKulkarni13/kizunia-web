-- Owned-project quota (Subscription Phase II, IB-12): the quota counts a
-- user's OWNER memberships, so it needs an index led by userId.
-- CreateIndex
CREATE INDEX "project_member_userId_role_idx" ON "public"."project_member"("userId", "role");
