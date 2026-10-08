-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'REFEREE', 'VIEWER');

-- CreateEnum
CREATE TYPE "TournamentStaffRole" AS ENUM ('ADMIN', 'REFEREE');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'VALIDATION_FAILED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHECKED_IN', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TeamMemberRole" AS ENUM ('CAPTAIN', 'MANAGER', 'PLAYER', 'SUBSTITUTE');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PlayerStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'DISBANDED');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BracketSide" AS ENUM ('W', 'L', 'GF');

-- CreateEnum
CREATE TYPE "MatchSlot" AS ENUM ('A', 'B');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'SCHEDULED', 'CHECK_IN_OPEN', 'CHECK_IN_EXPIRED', 'NO_SHOW_REVIEW', 'READY', 'IN_PROGRESS', 'RESULT_PENDING', 'DISPUTED', 'COMPLETED', 'FORFEITED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResultSource" AS ENUM ('GAME_API', 'PARTICIPANT', 'ADMIN');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('SUBMITTED', 'CONFIRMED', 'CONFLICTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'ASSIGNED', 'INVESTIGATING', 'RESOLVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DisputeReason" AS ENUM ('INCORRECT_RESULT', 'OPPONENT_NO_SHOW', 'DISCONNECT', 'SERVER_FAILURE', 'RULE_VIOLATION', 'SUSPECTED_CHEATING', 'INELIGIBLE_PLAYER');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('UPHOLD_RESULT', 'OVERTURN_RESULT', 'FORFEIT', 'REPLAY', 'DISMISSED');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('SCREENSHOT', 'MATCH_ID', 'GAME_LOG', 'CHAT', 'VIDEO_LINK', 'DESCRIPTION');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'DISCORD');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "mfaSecret" TEXT,
    "mfaEnabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "OrgRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invites" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'PC',
    "providerKey" TEXT NOT NULL DEFAULT 'manual',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "country" CHAR(2),
    "dateOfBirth" DATE,
    "status" "PlayerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_accounts" (
    "id" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "externalPlayerId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "region" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tag" TEXT,
    "logoUrl" TEXT,
    "gameId" UUID,
    "captainId" UUID NOT NULL,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "role" "TeamMemberRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_invites" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "invitedById" UUID NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'PLAYER',
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "team_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "region" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'PC',
    "format" "TournamentFormat" NOT NULL,
    "teamSize" INTEGER NOT NULL,
    "maxSubstitutes" INTEGER NOT NULL DEFAULT 0,
    "maxTeams" INTEGER NOT NULL,
    "bestOf" INTEGER NOT NULL DEFAULT 1,
    "finalsBestOf" INTEGER,
    "grandFinalReset" BOOLEAN NOT NULL DEFAULT true,
    "requireApproval" BOOLEAN NOT NULL DEFAULT true,
    "minAge" INTEGER,
    "registrationOpensAt" TIMESTAMP(3) NOT NULL,
    "registrationClosesAt" TIMESTAMP(3) NOT NULL,
    "checkInOpensAt" TIMESTAMP(3),
    "checkInClosesAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3) NOT NULL,
    "matchCheckInMinutes" INTEGER NOT NULL DEFAULT 15,
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "rules" TEXT NOT NULL DEFAULT '',
    "rulesVersion" INTEGER NOT NULL DEFAULT 1,
    "prizeInfo" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_staff" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "TournamentStaffRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'DRAFT',
    "seed" INTEGER,
    "submittedById" UUID NOT NULL,
    "rulesAcceptedAt" TIMESTAMP(3),
    "rulesVersion" INTEGER,
    "validationErrors" JSONB,
    "rejectionReason" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_members" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "playerId" UUID NOT NULL,
    "gameAccountId" UUID,
    "role" "TeamMemberRole" NOT NULL,

    CONSTRAINT "registration_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 1,
    "format" "TournamentFormat" NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "bracket" "BracketSide" NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "bestOf" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "bracket" "BracketSide" NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "bestOf" INTEGER NOT NULL DEFAULT 1,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledAt" TIMESTAMP(3),
    "checkInOpensAt" TIMESTAMP(3),
    "checkInDeadline" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "serverRegion" TEXT,
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "winnerSlot" "MatchSlot",
    "winnerTeamId" UUID,
    "resultSource" "ResultSource",
    "isBye" BOOLEAN NOT NULL DEFAULT false,
    "externalMatchId" TEXT,
    "winnerToMatchId" UUID,
    "winnerToSlot" "MatchSlot",
    "loserToMatchId" UUID,
    "loserToSlot" "MatchSlot",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "slot" "MatchSlot" NOT NULL,
    "registrationId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "checkedInAt" TIMESTAMP(3),

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_results" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "source" "ResultSource" NOT NULL,
    "externalRef" TEXT NOT NULL,
    "reportedById" UUID,
    "reportedBySlot" "MatchSlot",
    "scoreA" INTEGER NOT NULL,
    "scoreB" INTEGER NOT NULL,
    "winnerSlot" "MatchSlot" NOT NULL,
    "status" "ResultStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_evidence" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "storageKey" TEXT,
    "contentType" TEXT,
    "url" TEXT,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standings" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "placement" INTEGER,
    "eliminatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "openedById" UUID,
    "openedBySlot" "MatchSlot",
    "reason" "DisputeReason" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_evidence" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "storageKey" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "url" TEXT,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_decisions" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "decidedById" UUID NOT NULL,
    "outcome" "DisputeOutcome" NOT NULL,
    "winnerSlot" "MatchSlot",
    "scoreA" INTEGER,
    "scoreB" INTEGER,
    "ruling" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "organizationId" UUID,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" UUID,
    "requestHash" TEXT NOT NULL,
    "statusCode" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "organization_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "organization_members"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invites_tokenHash_key" ON "organization_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "organization_invites_organizationId_idx" ON "organization_invites"("organizationId");

-- CreateIndex
CREATE INDEX "organization_invites_email_idx" ON "organization_invites"("email");

-- CreateIndex
CREATE UNIQUE INDEX "games_slug_key" ON "games"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "players_userId_key" ON "players"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "game_accounts_gameId_externalPlayerId_key" ON "game_accounts"("gameId", "externalPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "game_accounts_playerId_gameId_key" ON "game_accounts"("playerId", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_slug_key" ON "teams"("slug");

-- CreateIndex
CREATE INDEX "team_members_playerId_idx" ON "team_members"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_teamId_playerId_key" ON "team_members"("teamId", "playerId");

-- CreateIndex
CREATE INDEX "team_invites_playerId_status_idx" ON "team_invites"("playerId", "status");

-- CreateIndex
CREATE INDEX "team_invites_teamId_idx" ON "team_invites"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "tournaments_slug_key" ON "tournaments"("slug");

-- CreateIndex
CREATE INDEX "tournaments_organizationId_status_idx" ON "tournaments"("organizationId", "status");

-- CreateIndex
CREATE INDEX "tournaments_status_startsAt_idx" ON "tournaments"("status", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_staff_tournamentId_userId_key" ON "tournament_staff"("tournamentId", "userId");

-- CreateIndex
CREATE INDEX "registrations_organizationId_tournamentId_status_idx" ON "registrations"("organizationId", "tournamentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_tournamentId_teamId_key" ON "registrations"("tournamentId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "registration_members_registrationId_playerId_key" ON "registration_members"("registrationId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "registration_members_tournamentId_playerId_key" ON "registration_members"("tournamentId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "stages_tournamentId_order_key" ON "stages"("tournamentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_stageId_bracket_number_key" ON "rounds"("stageId", "bracket", "number");

-- CreateIndex
CREATE INDEX "matches_tournamentId_status_idx" ON "matches"("tournamentId", "status");

-- CreateIndex
CREATE INDEX "matches_organizationId_status_scheduledAt_idx" ON "matches"("organizationId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "matches_externalMatchId_idx" ON "matches"("externalMatchId");

-- CreateIndex
CREATE UNIQUE INDEX "matches_stageId_key_key" ON "matches"("stageId", "key");

-- CreateIndex
CREATE INDEX "match_participants_teamId_idx" ON "match_participants"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "match_participants_matchId_slot_key" ON "match_participants"("matchId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "match_participants_matchId_registrationId_key" ON "match_participants"("matchId", "registrationId");

-- CreateIndex
CREATE INDEX "match_results_matchId_status_idx" ON "match_results"("matchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "match_results_matchId_source_externalRef_key" ON "match_results"("matchId", "source", "externalRef");

-- CreateIndex
CREATE INDEX "match_evidence_matchId_idx" ON "match_evidence"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "standings_registrationId_key" ON "standings"("registrationId");

-- CreateIndex
CREATE INDEX "standings_tournamentId_placement_idx" ON "standings"("tournamentId", "placement");

-- CreateIndex
CREATE INDEX "disputes_organizationId_status_idx" ON "disputes"("organizationId", "status");

-- CreateIndex
CREATE INDEX "disputes_matchId_idx" ON "disputes"("matchId");

-- CreateIndex
CREATE INDEX "dispute_evidence_disputeId_idx" ON "dispute_evidence"("disputeId");

-- CreateIndex
CREATE UNIQUE INDEX "dispute_decisions_disputeId_key" ON "dispute_decisions"("disputeId");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entityId_idx" ON "audit_logs"("entity", "entityId");

-- CreateIndex
CREATE INDEX "outbox_events_processedAt_createdAt_idx" ON "outbox_events"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_createdAt_idx" ON "notification_deliveries"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_key" ON "notification_deliveries"("notificationId", "channel");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invites" ADD CONSTRAINT "organization_invites_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "players" ADD CONSTRAINT "players_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_staff" ADD CONSTRAINT "tournament_staff_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_staff" ADD CONSTRAINT "tournament_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_members" ADD CONSTRAINT "registration_members_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_members" ADD CONSTRAINT "registration_members_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_members" ADD CONSTRAINT "registration_members_gameAccountId_fkey" FOREIGN KEY ("gameAccountId") REFERENCES "game_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_results" ADD CONSTRAINT "match_results_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_evidence" ADD CONSTRAINT "match_evidence_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standings" ADD CONSTRAINT "standings_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standings" ADD CONSTRAINT "standings_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standings" ADD CONSTRAINT "standings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_decisions" ADD CONSTRAINT "dispute_decisions_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_decisions" ADD CONSTRAINT "dispute_decisions_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
