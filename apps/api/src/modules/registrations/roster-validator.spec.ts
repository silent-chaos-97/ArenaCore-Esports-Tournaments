import { describe, expect, it } from 'vitest';
import { ageOn, validateRoster, type RosterCandidate } from './roster-validator.js';

const candidate = (
  playerId: string,
  overrides: Partial<RosterCandidate> = {},
): RosterCandidate => ({
  playerId,
  displayName: playerId,
  teamRole: 'PLAYER',
  active: true,
  status: 'ACTIVE',
  dateOfBirth: new Date('2000-01-01'),
  gameAccountId: `acc-${playerId}`,
  otherRegistration: false,
  ...overrides,
});
const rules = { teamSize: 2, maxSubstitutes: 1, minAge: null, now: new Date('2026-06-01') };

describe('validateRoster', () => {
  it('accepts a valid roster', () => {
    const map = new Map([
      ['a', candidate('a')],
      ['b', candidate('b')],
      ['c', candidate('c')],
    ]);
    expect(
      validateRoster(
        [
          { playerId: 'a', role: 'CAPTAIN' },
          { playerId: 'b', role: 'PLAYER' },
          { playerId: 'c', role: 'SUBSTITUTE' },
        ],
        map,
        rules,
      ),
    ).toEqual([]);
  });

  it('reports every problem at once', () => {
    const map = new Map([
      ['a', candidate('a', { gameAccountId: null })],
      ['b', candidate('b', { teamRole: null })],
      ['c', candidate('c', { otherRegistration: true, active: false })],
    ]);
    const codes = validateRoster(
      [
        { playerId: 'a', role: 'PLAYER' },
        { playerId: 'b', role: 'PLAYER' },
        { playerId: 'c', role: 'PLAYER' },
      ],
      map,
      rules,
    ).map((e) => e.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'STARTER_COUNT',
        'CAPTAIN_COUNT',
        'MISSING_GAME_ACCOUNT',
        'NOT_TEAM_MEMBER',
        'ALREADY_ON_ROSTER',
        'INACTIVE_MEMBER',
      ]),
    );
  });

  it('enforces minimum age when configured', () => {
    const map = new Map([
      ['a', candidate('a', { dateOfBirth: new Date('2012-06-02') })],
      ['b', candidate('b', { dateOfBirth: null })],
    ]);
    const codes = validateRoster(
      [
        { playerId: 'a', role: 'CAPTAIN' },
        { playerId: 'b', role: 'PLAYER' },
      ],
      map,
      { ...rules, minAge: 14 },
    ).map((e) => e.code);
    expect(codes).toEqual(['UNDER_MIN_AGE', 'MISSING_DATE_OF_BIRTH']);
  });

  it('computes age correctly around birthdays', () => {
    expect(ageOn(new Date('2010-06-01'), new Date('2026-06-01'))).toBe(16);
    expect(ageOn(new Date('2010-06-02'), new Date('2026-06-01'))).toBe(15);
  });
});
