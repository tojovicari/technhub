import { z } from 'zod';

export const listNotificationsQuerySchema = z.object({
  status:   z.enum(['queued', 'processing', 'sent', 'failed']).optional(),
  channel:  z.enum(['email', 'slack', 'whatsapp']).optional(),
  page:     z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
