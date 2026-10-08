import { z } from 'zod';
import { EVIDENCE_KINDS } from './enums.js';

const score = z.number().int().min(0).max(99);

export const evidenceLinkSchema = z
  .object({
    kind: z.enum(EVIDENCE_KINDS),
    url: z.url().max(1000).optional(),
    text: z.string().trim().max(2000).optional(),
  })
  .refine((e) => e.url || e.text, 'Evidence needs a link or a description');
export type EvidenceLinkInput = z.infer<typeof evidenceLinkSchema>;

export const reportResultSchema = z.object({
  scoreA: score,
  scoreB: score,
  evidence: z.array(evidenceLinkSchema).max(10).optional(),
});
export type ReportResultInput = z.infer<typeof reportResultSchema>;

export const adminResultSchema = z
  .object({
    scoreA: score.optional(),
    scoreB: score.optional(),
    /** Award the match to this side without scores (no-show, rule violation). */
    forfeitBy: z.enum(['A', 'B']).optional(),
    /** Required to replace a result that already advanced a team. */
    override: z.boolean().default(false),
    reason: z.string().trim().min(3).max(500),
  })
  .refine(
    (v) =>
      v.forfeitBy
        ? v.scoreA === undefined && v.scoreB === undefined
        : v.scoreA !== undefined && v.scoreB !== undefined,
    {
      message: 'Provide either both scores or forfeitBy',
    },
  );
export type AdminResultInput = z.infer<typeof adminResultSchema>;

export const setLobbySchema = z.object({
  externalMatchId: z.string().trim().min(1).max(200).nullable().optional(),
  serverRegion: z.string().trim().max(40).nullable().optional(),
});
export type SetLobbyInput = z.infer<typeof setLobbySchema>;

export const gameResultWebhookSchema = z.object({
  eventId: z.string().min(1).max(200),
  externalMatchId: z.string().min(1).max(200),
  /** Scores keyed by side as configured on the lobby; providers map their own team ids. */
  scoreA: score,
  scoreB: score,
});
export type GameResultWebhookInput = z.infer<typeof gameResultWebhookSchema>;

/** A best-of-N series is decided when one side reaches a majority and the other has fewer. */
export function seriesWinner(bestOf: number, scoreA: number, scoreB: number): 'A' | 'B' | null {
  const needed = Math.ceil(bestOf / 2);
  if (scoreA === needed && scoreB < needed) return 'A';
  if (scoreB === needed && scoreA < needed) return 'B';
  return null;
}

export interface MatchResultDto {
  id: string;
  source: string;
  reportedBySlot: 'A' | 'B' | null;
  scoreA: number;
  scoreB: number;
  winnerSlot: 'A' | 'B';
  status: string;
  note: string | null;
  createdAt: string;
}

export interface MatchEvidenceDto {
  id: string;
  kind: string;
  url: string | null;
  text: string | null;
  storageKey: string | null;
  contentType: string | null;
  uploadedById: string;
  createdAt: string;
}
