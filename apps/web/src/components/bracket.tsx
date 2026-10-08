'use client';

import type { BracketDto, MatchSummaryDto } from '@arenacore/shared';

const CARD_W = 220;
const CARD_H = 64;
const COL_GAP = 56;
const ROW_GAP = 20;
const SLOT_H = CARD_H + ROW_GAP;
const SECTION_GAP = 56;

const SECTION_TITLES: Record<'W' | 'L' | 'GF', string> = {
  W: 'Upper bracket',
  L: 'Lower bracket',
  GF: 'Grand final',
};
const LIVE = new Set(['READY', 'IN_PROGRESS', 'RESULT_PENDING', 'CHECK_IN_OPEN']);

interface Placed {
  match: MatchSummaryDto;
  x: number;
  y: number;
}

/**
 * The bracket drawn as a tree: rounds are columns, each match centred between the two matches
 * that feed it, joined by elbow connectors. Byes are de-emphasised, voided slots omitted.
 */
export function Bracket({
  bracket,
  onSelect,
  highlightTeamId,
}: {
  bracket: BracketDto;
  onSelect?: (match: MatchSummaryDto) => void;
  highlightTeamId?: string | null;
}) {
  const stage = bracket.stages[0];
  if (!stage) return null;
  const isDouble = stage.format === 'DOUBLE_ELIMINATION';
  const sections = (['W', 'L', 'GF'] as const)
    .map((side) => ({ side, rounds: stage.rounds.filter((r) => r.bracket === side) }))
    .filter((s) => s.rounds.length > 0);

  const placed = new Map<string, Placed>();
  const labels: { text: string; x: number; y: number; strong?: boolean }[] = [];
  const HEADER = isDouble ? 52 : 28;
  const upper = sections.find((s) => s.side === 'W');
  const upperHeight = Math.max(...(upper?.rounds.map((r) => r.matches.length) ?? [1])) * SLOT_H;
  let top = 0;
  let width = 0;
  let bottom = 0;

  for (const section of sections) {
    const gf = section.side === 'GF';
    // The grand final sits to the right of the upper bracket, level with its final.
    const height = gf ? SLOT_H : Math.max(...section.rounds.map((r) => r.matches.length)) * SLOT_H;
    const cardsTop = gf ? HEADER + upperHeight / 2 - SLOT_H / 2 : top + HEADER;
    const xOffset = gf ? (upper?.rounds.length ?? 0) * (CARD_W + COL_GAP) : 0;
    if (isDouble && !gf)
      labels.push({ text: SECTION_TITLES[section.side], x: 0, y: top, strong: true });
    section.rounds.forEach((round, col) => {
      const spacing = height / round.matches.length;
      const x = xOffset + col * (CARD_W + COL_GAP);
      labels.push({ text: round.name, x, y: cardsTop - 24 });
      round.matches.forEach((match, i) => {
        placed.set(match.id, { match, x, y: cardsTop + spacing * i + spacing / 2 - CARD_H / 2 });
      });
      width = Math.max(width, x + CARD_W);
    });
    bottom = Math.max(bottom, cardsTop + height);
    if (!gf) top = cardsTop + height + SECTION_GAP;
  }
  const height = bottom;

  const connectors: string[] = [];
  for (const { match, x, y } of placed.values()) {
    const target = match.winnerToMatchId ? placed.get(match.winnerToMatchId) : undefined;
    if (!target || isHidden(match) || target.x <= x) continue;
    const sameSection =
      target.match.bracket === match.bracket ||
      (match.bracket === 'W' && target.match.bracket === 'GF');
    if (!sameSection) continue;
    const x1 = x + CARD_W;
    const y1 = y + CARD_H / 2;
    const x2 = target.x;
    const y2 = target.y + CARD_H / 2;
    const mid = x1 + Math.min(COL_GAP / 2, (x2 - x1) / 2);
    connectors.push(`M${x1} ${y1} H${mid} V${y2} H${x2}`);
  }

  return (
    <div
      className="overflow-x-auto rounded-lg border border-rule bg-surface p-4"
      role="region"
      aria-label="Tournament bracket"
      tabIndex={0}
    >
      <div className="relative" style={{ width, height: height + 12 }}>
        <svg className="absolute inset-0 text-rule" width={width} height={height + 12} aria-hidden>
          {connectors.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={2} />
          ))}
        </svg>
        {labels.map((l, i) => (
          <div
            key={i}
            className={`absolute ${l.strong ? 'font-display text-xl font-bold text-ink' : 'text-sm font-semibold text-muted'}`}
            style={{ left: l.x, top: l.y }}
          >
            {l.text}
          </div>
        ))}
        {[...placed.values()].map(({ match, x, y }) =>
          isHidden(match) ? null : (
            <MatchCard
              key={match.id}
              match={match}
              style={{ left: x, top: y }}
              onSelect={onSelect}
              highlightTeamId={highlightTeamId}
            />
          ),
        )}
      </div>
    </div>
  );
}

function isHidden(match: MatchSummaryDto): boolean {
  return match.isBye && !match.a && !match.b;
}

function MatchCard({
  match,
  style,
  onSelect,
  highlightTeamId,
}: {
  match: MatchSummaryDto;
  style: React.CSSProperties;
  onSelect?: (match: MatchSummaryDto) => void;
  highlightTeamId?: string | null;
}) {
  const live = LIVE.has(match.status);
  const disputed = match.status === 'DISPUTED';
  const Tag = onSelect ? 'button' : 'div';
  return (
    <Tag
      type={onSelect ? 'button' : undefined}
      onClick={onSelect ? () => onSelect(match) : undefined}
      aria-label={`${match.roundName}: ${match.a?.teamName ?? 'TBD'} versus ${match.b?.teamName ?? 'TBD'}`}
      className={`absolute flex flex-col overflow-hidden rounded-md border bg-surface text-left ${
        disputed ? 'border-loss' : live ? 'border-amber' : 'border-rule'
      } ${match.isBye ? 'opacity-55' : ''} ${onSelect ? 'hover:border-cobalt' : ''}`}
      style={{ ...style, width: CARD_W, height: CARD_H }}
    >
      <Row side="A" match={match} highlightTeamId={highlightTeamId} />
      <div className="h-px bg-rule" />
      <Row side="B" match={match} highlightTeamId={highlightTeamId} />
      {(live || disputed) && (
        <span
          className={`absolute top-1 right-1 size-1.5 rounded-full ${disputed ? 'bg-loss' : 'live-dot bg-amber'}`}
          aria-hidden
        />
      )}
    </Tag>
  );
}

function Row({
  side,
  match,
  highlightTeamId,
}: {
  side: 'A' | 'B';
  match: MatchSummaryDto;
  highlightTeamId?: string | null;
}) {
  const team = side === 'A' ? match.a : match.b;
  const score = side === 'A' ? match.scoreA : match.scoreB;
  const decided = match.winnerSlot !== null;
  const won = match.winnerSlot === side;
  const mine = !!team && team.teamId === highlightTeamId;
  return (
    <div className={`flex h-[31px] items-center gap-2 px-2.5 ${mine ? 'bg-cobalt-wash' : ''}`}>
      <span className="w-5 shrink-0 text-xs text-muted">{team?.seed ?? ''}</span>
      <span
        className={`min-w-0 flex-1 truncate text-[15px] ${!team ? 'text-muted italic' : decided && !won ? 'text-muted' : 'font-semibold'}`}
      >
        {team?.teamName ?? (match.isBye ? 'Bye' : 'TBD')}
      </span>
      <span className={`font-display text-lg font-bold ${won ? 'text-win' : 'text-muted'}`}>
        {match.isBye ? '' : (score ?? (won ? 'W' : ''))}
      </span>
    </div>
  );
}
