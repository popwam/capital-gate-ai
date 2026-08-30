ALTER TABLE "FollowUpTask" ADD COLUMN "dedupeKey" TEXT;
CREATE UNIQUE INDEX "FollowUpTask_dedupeKey_key" ON "FollowUpTask"("dedupeKey");
