-- AlterTable User: role, active, lastLoginAt
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

-- CreateTable UserActivity
CREATE TABLE IF NOT EXISTS "UserActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserActivity_createdAt_idx" ON "UserActivity"("createdAt");
CREATE INDEX IF NOT EXISTS "UserActivity_userId_idx" ON "UserActivity"("userId");

DO $$ BEGIN
  ALTER TABLE "UserActivity" ADD CONSTRAINT "UserActivity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
