-- AlterTable Traveler: authorization fields
ALTER TABLE "Traveler" ADD COLUMN IF NOT EXISTS "relationship" TEXT NOT NULL DEFAULT 'self';
ALTER TABLE "Traveler" ADD COLUMN IF NOT EXISTS "authorizedConsent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Traveler" ADD COLUMN IF NOT EXISTS "authorizedConsentAt" TIMESTAMP(3);

-- AlterTable WatchJob: bind travelers
ALTER TABLE "WatchJob" ADD COLUMN IF NOT EXISTS "travelerIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
