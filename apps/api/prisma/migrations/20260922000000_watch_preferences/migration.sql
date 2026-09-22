-- AlterTable
ALTER TABLE "WatchJob" ADD COLUMN IF NOT EXISTS "preferences" JSONB;
