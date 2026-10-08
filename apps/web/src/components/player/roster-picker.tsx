'use client';

import type { TeamDto } from '@arenacore/shared';
import { useEffect, useState } from 'react';

export interface RosterChoice {
  playerId: string;
  role: 'CAPTAIN' | 'PLAYER' | 'SUBSTITUTE';
}

type Slot = 'CAPTAIN' | 'PLAYER' | 'SUBSTITUTE' | 'OUT';

/** Picks the tournament roster from the team: who starts, who's a substitute, who sits out. */
export function RosterPicker({
  team,
  teamSize,
  maxSubstitutes,
  onChange,
}: {
  team: TeamDto;
  teamSize: number;
  maxSubstitutes: number;
  onChange: (roster: RosterChoice[]) => void;
}) {
  const [slots, setSlots] = useState<Record<string, Slot>>(() =>
    Object.fromEntries(
      team.members.map((m) => [
        m.playerId,
        !m.active
          ? 'OUT'
          : m.role === 'CAPTAIN'
            ? 'CAPTAIN'
            : m.role === 'SUBSTITUTE'
              ? 'SUBSTITUTE'
              : m.role === 'MANAGER'
                ? 'OUT'
                : 'PLAYER',
      ]),
    ),
  );
  useEffect(() => {
    onChange(
      Object.entries(slots)
        .filter(([, s]) => s !== 'OUT')
        .map(([playerId, role]) => ({ playerId, role: role as RosterChoice['role'] })),
    );
  }, [slots, onChange]);
  const starters = Object.values(slots).filter((s) => s === 'CAPTAIN' || s === 'PLAYER').length;
  const subs = Object.values(slots).filter((s) => s === 'SUBSTITUTE').length;

  return (
    <div className="flex flex-col gap-2">
      <p
        className={`text-[15px] ${starters === teamSize && subs <= maxSubstitutes ? 'text-win' : 'text-muted'}`}
      >
        {starters} of {teamSize} starters
        {maxSubstitutes > 0 ? `, ${subs} of up to ${maxSubstitutes} substitutes` : ''}. One starter
        must be captain.
      </p>
      <ul className="flex flex-col divide-y divide-rule rounded-lg border border-rule bg-surface">
        {team.members.map((m) => (
          <li
            key={m.playerId}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
          >
            <span className="font-semibold">{m.displayName}</span>
            <select
              aria-label={`Tournament role for ${m.displayName}`}
              value={slots[m.playerId]}
              onChange={(e) => setSlots((s) => ({ ...s, [m.playerId]: e.target.value as Slot }))}
              className="h-9 rounded-md border border-rule bg-surface px-2 text-[15px]"
            >
              <option value="CAPTAIN">Captain</option>
              <option value="PLAYER">Starter</option>
              <option value="SUBSTITUTE">Substitute</option>
              <option value="OUT">Not playing</option>
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}
