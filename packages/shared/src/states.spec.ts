import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  disputeMachine,
  matchMachine,
  registrationMachine,
  tournamentMachine,
} from './index.js';

describe('state machines', () => {
  it('follows the spec registration happy path', () => {
    const path = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'CHECKED_IN'] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(registrationMachine, path[i]!, path[i + 1]!)).toBe(true);
    }
    expect(canTransition(registrationMachine, 'SUBMITTED', 'REJECTED')).toBe(true);
    expect(canTransition(registrationMachine, 'SUBMITTED', 'VALIDATION_FAILED')).toBe(true);
  });

  it('follows the spec match lifecycle and no-show path', () => {
    const path = [
      'SCHEDULED',
      'CHECK_IN_OPEN',
      'READY',
      'IN_PROGRESS',
      'RESULT_PENDING',
      'COMPLETED',
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(matchMachine, path[i]!, path[i + 1]!)).toBe(true);
    }
    expect(canTransition(matchMachine, 'CHECK_IN_OPEN', 'CHECK_IN_EXPIRED')).toBe(true);
    expect(canTransition(matchMachine, 'CHECK_IN_EXPIRED', 'NO_SHOW_REVIEW')).toBe(true);
  });

  it('follows the spec dispute workflow', () => {
    expect(canTransition(disputeMachine, 'OPEN', 'ASSIGNED')).toBe(true);
    expect(canTransition(disputeMachine, 'ASSIGNED', 'INVESTIGATING')).toBe(true);
    expect(canTransition(disputeMachine, 'INVESTIGATING', 'RESOLVED')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(() => assertTransition(tournamentMachine, 'COMPLETED', 'DRAFT')).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertTransition(matchMachine, 'CANCELLED', 'READY')).toThrow(
      /match transition: CANCELLED → READY/,
    );
  });

  it('only references declared states', () => {
    for (const m of [tournamentMachine, registrationMachine, matchMachine, disputeMachine]) {
      const states = new Set<string>(m.states);
      for (const targets of Object.values<readonly string[]>(m.transitions)) {
        for (const t of targets) expect(states.has(t)).toBe(true);
      }
    }
  });
});
