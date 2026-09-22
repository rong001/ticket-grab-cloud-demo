-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('train', 'show', 'flight');

-- CreateEnum
CREATE TYPE "WatchJobStatus" AS ENUM ('pending', 'active', 'paused', 'completed', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "fields" JSONB NOT NULL,
    "notifyOnly" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortlistSnapshot" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchJob" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "WatchJobStatus" NOT NULL DEFAULT 'pending',
    "intervalMinutes" INTEGER NOT NULL DEFAULT 15,
    "endsAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "bullJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB,
    "emailed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "TicketRequest_userId_idx" ON "TicketRequest"("userId");

-- CreateIndex
CREATE INDEX "ShortlistSnapshot_requestId_idx" ON "ShortlistSnapshot"("requestId");

-- CreateIndex
CREATE INDEX "WatchJob_requestId_idx" ON "WatchJob"("requestId");

-- CreateIndex
CREATE INDEX "WatchJob_status_idx" ON "WatchJob"("status");

-- CreateIndex
CREATE INDEX "NotificationEvent_requestId_idx" ON "NotificationEvent"("requestId");

-- AddForeignKey
ALTER TABLE "TicketRequest" ADD CONSTRAINT "TicketRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistSnapshot" ADD CONSTRAINT "ShortlistSnapshot_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TicketRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchJob" ADD CONSTRAINT "WatchJob_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TicketRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TicketRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
