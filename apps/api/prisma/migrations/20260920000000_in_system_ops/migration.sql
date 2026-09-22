-- CreateEnum
CREATE TYPE "TravelerType" AS ENUM ('adult', 'child');

-- CreateEnum
CREATE TYPE "PlatformKind" AS ENUM ('12306', 'damai', 'maoyan', 'airline');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('unlinked', 'needs_browser_login', 'linked', 'expired');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('draft', 'awaiting_login', 'submitting', 'awaiting_payment', 'paid', '候补中', 'failed', 'cancelled');

-- AlterTable NotificationEvent: requestId optional + orderId
ALTER TABLE "NotificationEvent" ALTER COLUMN "requestId" DROP NOT NULL;
ALTER TABLE "NotificationEvent" ADD COLUMN "orderId" TEXT;

-- CreateTable Traveler
CREATE TABLE "Traveler" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idType" TEXT NOT NULL DEFAULT 'id_card',
    "idNumberEnc" TEXT NOT NULL,
    "idNumberHint" TEXT,
    "phone" TEXT,
    "type" "TravelerType" NOT NULL DEFAULT 'adult',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Traveler_pkey" PRIMARY KEY ("id")
);

-- CreateTable PlatformCredential
CREATE TABLE "PlatformCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "PlatformKind" NOT NULL,
    "sessionStatus" "SessionStatus" NOT NULL DEFAULT 'unlinked',
    "vaultRef" TEXT,
    "sessionCookieEnc" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable Order
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'draft',
    "selectedShortlistItemId" TEXT NOT NULL,
    "travelerIds" TEXT[],
    "amount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "externalOrderId" TEXT,
    "payload" JSONB,
    "errorMessage" TEXT,
    "paymentUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- Indexes / FKs
CREATE INDEX "Traveler_userId_idx" ON "Traveler"("userId");
CREATE INDEX "PlatformCredential_userId_idx" ON "PlatformCredential"("userId");
CREATE UNIQUE INDEX "PlatformCredential_userId_platform_key" ON "PlatformCredential"("userId", "platform");
CREATE INDEX "Order_userId_idx" ON "Order"("userId");
CREATE INDEX "Order_requestId_idx" ON "Order"("requestId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "NotificationEvent_orderId_idx" ON "NotificationEvent"("orderId");

ALTER TABLE "Traveler" ADD CONSTRAINT "Traveler_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformCredential" ADD CONSTRAINT "PlatformCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TicketRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
