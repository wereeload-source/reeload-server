-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'sales', 'ops', 'reelmaker', 'accounts');

-- CreateEnum
CREATE TYPE "ReelmakerKind" AS ENUM ('full_time', 'freelance');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('lead', 'draft', 'confirmed', 'assigned', 'accepted', 'reached', 'uploaded', 'released', 'paid', 'delivered', 'closed', 'cancelled');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('pending', 'accepted', 'declined', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('upi', 'bank_transfer', 'cash');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ChargeDecision" AS ENUM ('pending', 'charge', 'no_charge');

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('proof', 'raw', 'edited');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('uploading', 'complete', 'aborted', 'deleted');

-- CreateEnum
CREATE TYPE "ContactOutcome" AS ENUM ('spoken', 'follow_up', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "CheckinMethod" AS ENUM ('otp', 'ops_release');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reelmakers" (
    "userId" UUID NOT NULL,
    "kind" "ReelmakerKind" NOT NULL DEFAULT 'full_time',
    "baseCity" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "reelmakers_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "city" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "clientId" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'draft',
    "city" TEXT NOT NULL,
    "address" TEXT,
    "mapsUrl" TEXT,
    "startsAt" TIMESTAMPTZ,
    "durationMinutes" INTEGER,
    "onsiteContactName" TEXT,
    "onsiteContactPhone" TEXT,
    "brief" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID,
    "confirmedAt" TIMESTAMPTZ,
    "releasedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_money" (
    "jobId" UUID NOT NULL,
    "agreedAmount" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "job_money_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "isAdvance" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extra_time" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "addedById" UUID,
    "decision" "ChargeDecision" NOT NULL DEFAULT 'pending',
    "decidedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extra_time_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_changes" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "delta" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "extraTimeId" UUID,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "requestedById" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "reelmakerId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ NOT NULL,
    "endsAt" TIMESTAMPTZ NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "assignedById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave" (
    "id" UUID NOT NULL,
    "reelmakerId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ NOT NULL,
    "endsAt" TIMESTAMPTZ NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploads" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "kind" "UploadKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT,
    "sizeBytes" BIGINT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "r2UploadId" TEXT,
    "status" "UploadStatus" NOT NULL DEFAULT 'uploading',
    "uploadedById" UUID NOT NULL,
    "onBehalfOfId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkins" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "reelmakerId" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "otpHash" TEXT,
    "otpExpiresAt" TIMESTAMPTZ,
    "otpSends" INTEGER NOT NULL DEFAULT 0,
    "otpLastSentAt" TIMESTAMPTZ,
    "otpAttempts" INTEGER NOT NULL DEFAULT 0,
    "method" "CheckinMethod",
    "verifiedAt" TIMESTAMPTZ,
    "releaseReason" TEXT,
    "releasedById" UUID,
    "selfieUploadId" UUID,
    "locationUploadId" UUID,
    "completedAt" TIMESTAMPTZ,

    CONSTRAINT "checkins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "includeRaw" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_log" (
    "id" UUID NOT NULL,
    "salespersonId" UUID NOT NULL,
    "clientId" UUID,
    "clientName" TEXT NOT NULL,
    "phone" TEXT,
    "outcome" "ContactOutcome" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "family_expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "claims" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "clients_phone_key" ON "clients"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_number_key" ON "jobs"("number");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_startsAt_idx" ON "jobs"("startsAt");

-- CreateIndex
CREATE INDEX "payments_jobId_idx" ON "payments"("jobId");

-- CreateIndex
CREATE INDEX "assignments_jobId_idx" ON "assignments"("jobId");

-- CreateIndex
CREATE INDEX "assignments_reelmakerId_status_startsAt_idx" ON "assignments"("reelmakerId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "leave_reelmakerId_startsAt_idx" ON "leave"("reelmakerId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "uploads_objectKey_key" ON "uploads"("objectKey");

-- CreateIndex
CREATE INDEX "uploads_jobId_kind_idx" ON "uploads"("jobId", "kind");

-- CreateIndex
CREATE INDEX "uploads_jobId_uploadedById_fileName_sizeBytes_status_idx" ON "uploads"("jobId", "uploadedById", "fileName", "sizeBytes", "status");

-- CreateIndex
CREATE UNIQUE INDEX "checkins_jobId_reelmakerId_key" ON "checkins"("jobId", "reelmakerId");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_tokenHash_key" ON "share_links"("tokenHash");

-- CreateIndex
CREATE INDEX "contact_log_salespersonId_createdAt_idx" ON "contact_log"("salespersonId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at" DESC);

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_idx" ON "notifications"("userId", "readAt");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_expires_at_idx" ON "refresh_tokens"("family_expires_at");

-- AddForeignKey
ALTER TABLE "reelmakers" ADD CONSTRAINT "reelmakers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_money" ADD CONSTRAINT "job_money_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extra_time" ADD CONSTRAINT "extra_time_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extra_time" ADD CONSTRAINT "extra_time_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extra_time" ADD CONSTRAINT "extra_time_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_extraTimeId_fkey" FOREIGN KEY ("extraTimeId") REFERENCES "extra_time"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_reelmakerId_fkey" FOREIGN KEY ("reelmakerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave" ADD CONSTRAINT "leave_reelmakerId_fkey" FOREIGN KEY ("reelmakerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_onBehalfOfId_fkey" FOREIGN KEY ("onBehalfOfId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_reelmakerId_fkey" FOREIGN KEY ("reelmakerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkins" ADD CONSTRAINT "checkins_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_log" ADD CONSTRAINT "contact_log_salespersonId_fkey" FOREIGN KEY ("salespersonId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
