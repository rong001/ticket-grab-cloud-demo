-- AlterEnum: add lifecycle statuses
ALTER TYPE "WatchJobStatus" ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE "WatchJobStatus" ADD VALUE IF NOT EXISTS 'querying';
ALTER TYPE "WatchJobStatus" ADD VALUE IF NOT EXISTS 'has_tickets';
ALTER TYPE "WatchJobStatus" ADD VALUE IF NOT EXISTS 'notified';

-- AlterTable
ALTER TABLE "WatchJob" ADD COLUMN IF NOT EXISTS "statusReason" TEXT;
ALTER TABLE "WatchJob" ADD COLUMN IF NOT EXISTS "statusChangedAt" TIMESTAMP(3);

-- Backfill pending -> queued for active watches display clarity (keep DB value; app maps)
UPDATE "WatchJob" SET "statusReason" = COALESCE("statusReason", 'migrated'), "statusChangedAt" = COALESCE("statusChangedAt", NOW())
WHERE "statusChangedAt" IS NULL;
