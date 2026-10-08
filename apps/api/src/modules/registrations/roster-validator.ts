import type { RosterEntry, RosterValidationError } from '@arenacore/shared';

export interface RosterCandidate {
  playerId: string;
  displayName: string;
  teamRole: string | null; // null = not on the team
  active: boolean;
  status: string;
  dateOfBirth: Date | null;
  gameAccountId: string | null;
  otherRegistration: boolean;
}

export interface RosterRules {
  teamSize: number;
  maxSubstitutes: number;
  minAge: number | null;
  now: Date;
}

/** Pure roster eligibility check; returns every problem so captains can fix them in one go. */
export function validateRoster(
  entries: RosterEntry[],
  candidates: Map<string, RosterCandidate>,
  rules: RosterRules,
): RosterValidationError[] {
  const errors: RosterValidationError[] = [];
  const starters = entries.filter((e) => e.role !== 'SUBSTITUTE');
  const subs = entries.filter((e) => e.role === 'SUBSTITUTE');
  const captains = entries.filter((e) => e.role === 'CAPTAIN');

  if (starters.length !== rules.teamSize) {
    errors.push({
      code: 'STARTER_COUNT',
      message: `Roster needs exactly ${rules.teamSize} starting players (got ${starters.length})`,
    });
  }
  if (subs.length > rules.maxSubstitutes) {
    errors.push({
      code: 'TOO_MANY_SUBSTITUTES',
      message: `At most ${rules.maxSubstitutes} substitutes are allowed`,
    });
  }
  if (captains.length !== 1) {
    errors.push({ code: 'CAPTAIN_COUNT', message: 'Roster must have exactly one captain' });
  }

  for (const entry of entries) {
    const c = candidates.get(entry.playerId);
    const name = c?.displayName ?? entry.playerId;
    if (!c || c.teamRole === null) {
      errors.push({
        code: 'NOT_TEAM_MEMBER',
        message: `${name} is not on this team`,
        playerId: entry.playerId,
      });
      continue;
    }
    if (!c.active)
      errors.push({
        code: 'INACTIVE_MEMBER',
        message: `${name} is marked inactive`,
        playerId: c.playerId,
      });
    if (c.status !== 'ACTIVE')
      errors.push({
        code: 'PLAYER_SUSPENDED',
        message: `${name} is suspended`,
        playerId: c.playerId,
      });
    if (!c.gameAccountId) {
      errors.push({
        code: 'MISSING_GAME_ACCOUNT',
        message: `${name} has not linked a game account`,
        playerId: c.playerId,
      });
    }
    if (c.otherRegistration) {
      errors.push({
        code: 'ALREADY_ON_ROSTER',
        message: `${name} is already registered with another team`,
        playerId: c.playerId,
      });
    }
    if (rules.minAge !== null) {
      if (!c.dateOfBirth) {
        errors.push({
          code: 'MISSING_DATE_OF_BIRTH',
          message: `${name} must provide a date of birth`,
          playerId: c.playerId,
        });
      } else if (ageOn(c.dateOfBirth, rules.now) < rules.minAge) {
        errors.push({
          code: 'UNDER_MIN_AGE',
          message: `${name} is younger than ${rules.minAge}`,
          playerId: c.playerId,
        });
      }
    }
  }
  return errors;
}

export function ageOn(dob: Date, now: Date): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < dob.getUTCMonth() ||
    (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}
