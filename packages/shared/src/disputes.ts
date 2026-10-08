import { z } from 'zod';
import { DISPUTE_REASONS } from './enums.js';
import { evidenceLinkSchema } from './matches.js';
import { DISPUTE_STATUSES } from './states.js';

export const openDisputeSchema = z.object({
  reason: z.enum(DISPUTE_REASONS),
  description: z.string().trim().min(10).max(4000),
  evidence: z.array(evidenceLinkSchema).max(10).optional(),
});
export type OpenDisputeInput = z.infer<typeof openDisputeSchema>;

/** Uploadable evidence types; anything else must be shared as a link. */
export const EVIDENCE_MIME_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'text/plain': 'txt',
  'application/json': 'json',
  'video/mp4': 'mp4',
} as const;
export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

export const evidenceUploadRequestSchema = z.object({
  kind: z.enum(['SCREENSHOT', 'GAME_LOG', 'CHAT', 'VIDEO_LINK']),
  contentType: z.enum(
    Object.keys(EVIDENCE_MIME_TYPES) as [
      keyof typeof EVIDENCE_MIME_TYPES,
      ...(keyof typeof EVIDENCE_MIME_TYPES)[],
    ],
  ),
  sizeBytes: z.number().int().min(1).max(MAX_EVIDENCE_BYTES),
});
export type EvidenceUploadRequest = z.infer<typeof evidenceUploadRequestSchema>;

export const addEvidenceSchema = z.union([
  evidenceLinkSchema,
  z.object({
    kind: z.enum(['SCREENSHOT', 'GAME_LOG', 'CHAT', 'VIDEO_LINK']),
    storageKey: z.string().min(10).max(300),
  }),
]);
export type AddEvidenceInput = z.infer<typeof addEvidenceSchema>;

export const assignDisputeSchema = z.object({ refereeUserId: z.uuid().optional() });
export type AssignDisputeInput = z.infer<typeof assignDisputeSchema>;

export const DISPUTE_OUTCOMES = [
  'UPHOLD_RESULT',
  'OVERTURN_RESULT',
  'FORFEIT',
  'REPLAY',
  'DISMISSED',
] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

export const resolveDisputeSchema = z
  .object({
    outcome: z.enum(DISPUTE_OUTCOMES),
    /** OVERTURN_RESULT: the corrected winner; FORFEIT: the side that is awarded the match. */
    winnerSlot: z.enum(['A', 'B']).optional(),
    scoreA: z.number().int().min(0).max(99).optional(),
    scoreB: z.number().int().min(0).max(99).optional(),
    ruling: z.string().trim().min(10).max(4000),
  })
  .superRefine((v, ctx) => {
    if (v.outcome === 'OVERTURN_RESULT' && (v.scoreA === undefined || v.scoreB === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['scoreA'],
        message: 'Overturning requires the corrected scores',
      });
    }
    if (v.outcome === 'FORFEIT' && !v.winnerSlot) {
      ctx.addIssue({
        code: 'custom',
        path: ['winnerSlot'],
        message: 'A forfeit needs the side that is awarded the win',
      });
    }
  });
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;

export const listDisputesQuerySchema = z.object({
  status: z.enum(DISPUTE_STATUSES).optional(),
  tournamentId: z.uuid().optional(),
  assignedToMe: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type ListDisputesQuery = z.infer<typeof listDisputesQuerySchema>;

export interface DisputeEvidenceDto {
  id: string;
  kind: string;
  url: string | null;
  text: string | null;
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedById: string;
  createdAt: string;
}

export interface DisputeDto {
  id: string;
  tournamentId: string;
  tournamentName: string;
  matchId: string;
  matchKey: string;
  reason: string;
  description: string;
  status: string;
  openedBySlot: 'A' | 'B' | null;
  openedById: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  createdAt: string;
  resolvedAt: string | null;
  version: number;
  evidence: DisputeEvidenceDto[];
  decision: {
    outcome: string;
    winnerSlot: 'A' | 'B' | null;
    scoreA: number | null;
    scoreB: number | null;
    ruling: string;
    decidedById: string;
    createdAt: string;
  } | null;
}
