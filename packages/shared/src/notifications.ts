import { z } from 'zod';

export const listNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}
