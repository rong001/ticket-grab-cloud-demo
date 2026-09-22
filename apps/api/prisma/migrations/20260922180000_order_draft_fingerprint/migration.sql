-- AlterTable Order: draftFingerprint for idempotent watch→draft lookup (replaces take:20 window)
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "draftFingerprint" TEXT;

-- Backfill from payload.draftFingerprint when present (keep earliest row per fingerprint)
UPDATE "Order" o
SET "draftFingerprint" = o.payload->>'draftFingerprint'
WHERE o."draftFingerprint" IS NULL
  AND o.payload IS NOT NULL
  AND o.payload->>'draftFingerprint' IS NOT NULL
  AND o.payload->>'draftFingerprint' <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "Order" x
    WHERE x."draftFingerprint" = o.payload->>'draftFingerprint'
  )
  AND o.id = (
    SELECT o2.id FROM "Order" o2
    WHERE o2.payload->>'draftFingerprint' = o.payload->>'draftFingerprint'
    ORDER BY o2."createdAt" ASC
    LIMIT 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS "Order_draftFingerprint_key" ON "Order"("draftFingerprint");
CREATE INDEX IF NOT EXISTS "Order_userId_draftFingerprint_idx" ON "Order"("userId", "draftFingerprint");
