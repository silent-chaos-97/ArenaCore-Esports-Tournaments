import type { NotificationType } from '@arenacore/shared';

/** Who should hear about an event. Resolved to user ids by RecipientResolver. */
export type Audience =
  | { kind: 'registration'; registrationId: string }
  | { kind: 'match'; matchId: string; onlyRegistrationId?: string | null }
  | { kind: 'user'; userId: string }
  | { kind: 'orgStaff'; organizationId: string };

export interface NotificationPlan {
  type: NotificationType;
  audiences: Audience[];
  title: string;
  body: string;
  data: Record<string, unknown>;
  email: boolean;
}

interface OutboxLike {
  id: string;
  type: string;
  organizationId: string | null;
  payload: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Maps domain events to participant-facing notifications (spec §4 Notifications). */
export function planNotifications(event: OutboxLike): NotificationPlan[] {
  const p = event.payload;
  const matchId = str(p.matchId);
  switch (event.type) {
    case 'RegistrationApproved':
      return [
        {
          type: 'REGISTRATION_APPROVED',
          audiences: [{ kind: 'registration', registrationId: str(p.registrationId) }],
          title: 'Registration approved',
          body: `Your team is in for ${str(p.tournamentName)}.`,
          data: { tournamentId: p.tournamentId, registrationId: p.registrationId },
          email: true,
        },
      ];
    case 'RegistrationRejected':
      return [
        {
          type: 'REGISTRATION_REJECTED',
          audiences: [{ kind: 'registration', registrationId: str(p.registrationId) }],
          title: 'Registration not approved',
          body: `Your registration for ${str(p.tournamentName)} was rejected${p.reason ? `: ${str(p.reason)}` : '.'}`,
          data: { tournamentId: p.tournamentId, registrationId: p.registrationId },
          email: true,
        },
      ];
    case 'MatchReady':
      return [
        {
          type: 'MATCH_STARTING_SOON',
          audiences: [{ kind: 'match', matchId }],
          title: 'Your next match is set',
          body: 'Your opponent is confirmed. Check the schedule and be ready for check-in.',
          data: { matchId, tournamentId: p.tournamentId },
          email: false,
        },
      ];
    case 'CheckInOpened':
      return [
        {
          type: 'CHECK_IN_OPENED',
          audiences: [{ kind: 'match', matchId }],
          title: 'Match check-in is open',
          body: 'Check in now so your match can start on time.',
          data: { matchId, tournamentId: p.tournamentId, deadline: p.deadline },
          email: true,
        },
      ];
    case 'MatchStartingSoon':
      return [
        {
          type: 'MATCH_STARTING_SOON',
          audiences: [{ kind: 'match', matchId }],
          title: 'Match starting soon',
          body: `Your match starts at ${str(p.scheduledAt)}.`,
          data: { matchId, tournamentId: p.tournamentId, scheduledAt: p.scheduledAt },
          email: true,
        },
      ];
    case 'OpponentCheckedIn':
      return p.notifyRegistrationId
        ? [
            {
              type: 'OPPONENT_READY',
              audiences: [
                { kind: 'match', matchId, onlyRegistrationId: str(p.notifyRegistrationId) },
              ],
              title: 'Your opponent checked in',
              body: 'Your opponent is ready. Check in to start the match.',
              data: { matchId, tournamentId: p.tournamentId },
              email: false,
            },
          ]
        : [];
    case 'MatchRescheduled':
      return [
        {
          type: 'MATCH_RESCHEDULED',
          audiences: [{ kind: 'match', matchId }],
          title: 'Match rescheduled',
          body: `Your match was moved to ${str(p.scheduledAt)}.`,
          data: { matchId, tournamentId: p.tournamentId, scheduledAt: p.scheduledAt },
          email: true,
        },
      ];
    case 'MatchCompleted':
      return [
        {
          type: 'RESULT_CONFIRMED',
          audiences: [{ kind: 'match', matchId }],
          title: 'Result confirmed',
          body: p.forfeited
            ? 'The match was decided by forfeit.'
            : `Final score ${String(p.scoreA)}-${String(p.scoreB)}.`,
          data: { matchId, tournamentId: p.tournamentId, winnerSlot: p.winnerSlot },
          email: false,
        },
      ];
    case 'ResultReported':
      return [
        {
          type: 'RESULT_CONFIRMED',
          audiences: [{ kind: 'match', matchId }],
          title: 'Score reported',
          body: `A score of ${String(p.scoreA)}-${String(p.scoreB)} was reported. Confirm it or report your own.`,
          data: { matchId, tournamentId: p.tournamentId, reportedBySlot: p.reportedBySlot },
          email: false,
        },
      ];
    case 'DisputeOpened':
      return [
        {
          type: 'DISPUTE_OPENED',
          audiences: [{ kind: 'match', matchId }],
          title: 'Match disputed',
          body: 'A dispute was opened for your match. A referee will review it.',
          data: { matchId, disputeId: p.disputeId, tournamentId: p.tournamentId },
          email: true,
        },
        ...(event.organizationId
          ? [
              {
                type: 'DISPUTE_OPENED' as const,
                audiences: [{ kind: 'orgStaff' as const, organizationId: event.organizationId }],
                title: 'New dispute to review',
                body: `Reason: ${str(p.reason).replaceAll('_', ' ').toLowerCase()}.`,
                data: { matchId, disputeId: p.disputeId, tournamentId: p.tournamentId },
                email: false,
              },
            ]
          : []),
      ];
    case 'DisputeResolved':
      return [
        {
          type: 'DISPUTE_RESOLVED',
          audiences: [{ kind: 'match', matchId }],
          title: 'Dispute resolved',
          body: `The referee ruled: ${str(p.outcome).replaceAll('_', ' ').toLowerCase()}.`,
          data: {
            matchId,
            disputeId: p.disputeId,
            tournamentId: p.tournamentId,
            outcome: p.outcome,
          },
          email: true,
        },
      ];
    case 'TeamAdvanced':
      return [
        {
          type: 'ADVANCED',
          audiences: [{ kind: 'registration', registrationId: str(p.registrationId) }],
          title: 'You advanced!',
          body: 'Your team moves on to the next round.',
          data: { tournamentId: p.tournamentId, matchId: p.toMatchId },
          email: false,
        },
      ];
    case 'TeamEliminated':
      return [
        {
          type: 'ELIMINATED',
          audiences: [{ kind: 'registration', registrationId: str(p.registrationId) }],
          title: 'Tournament run ended',
          body: p.placement
            ? `Your team finished in place ${String(p.placement)}.`
            : 'Your team has been eliminated.',
          data: { tournamentId: p.tournamentId, placement: p.placement },
          email: false,
        },
      ];
    case 'TeamInviteCreated':
      return [
        {
          type: 'TEAM_INVITE',
          audiences: [{ kind: 'user', userId: str(p.userId) }],
          title: 'Team invitation',
          body: `You were invited to join ${str(p.teamName)}.`,
          data: { inviteId: p.inviteId, teamId: p.teamId },
          email: true,
        },
      ];
    default:
      return [];
  }
}
