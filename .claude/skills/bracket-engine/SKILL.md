---
name: bracket-engine
description: Work on packages/bracket (seeding, single/double elimination, result application, standings) and its property tests. Use when changing bracket generation, advancement, byes, or standings logic, or when debugging an invalid bracket state.
---

# Bracket engine

`packages/bracket` is pure TypeScript with no database access and no Date.now(). The API maps its output to Stage, Round and Match rows.

## Model
- A `BracketPlan` holds `matches: PlannedMatch[]`. Each match has a `key`, `bracket` (`W` | `L` | `GF`), `round` and `position`, plus two slots.
- A slot is `{ seed }`, `{ fromMatch, outcome: 'winner'|'loser' }` or `{ bye: true }`.
- Each match also carries `winnerTo` and `loserTo` (`{ matchKey, slot }` or null). The bracket is a DAG.
- `applyResult(state, matchKey, winnerSide)` returns the next state and the list of matches that became ready. It never mutates its input.
- Removing a result is done with `resetFrom(matchKey)`: it clears the match and everything downstream that depended on it.

## Invariants (all checked by fast-check)
1. For N participants, single elimination has `nextPow2(N) - 1` matches and `ceil(log2 N)` rounds. Byes go to the top seeds.
2. Every participant appears in exactly one round-1 slot, or gets a bye that advances them.
3. Playing any valid sequence of results leaves exactly one champion. Every other participant is eliminated exactly once in SE, or twice in DE (except the grand-final reset case).
4. Applying the same result twice is a no-op (idempotent).
5. No match is ever ready with a participant still unresolved.
6. Double elimination: losers-bracket feeds alternate their order to avoid immediate rematches. The grand final is reset only when the loser-bracket champion wins GF1.

## Testing
`pnpm --filter @arenacore/bracket test`. Each new rule needs a property test. Use `fc.integer({min:2,max:64})` for the participant count and a random winner picker.
