import { z } from 'zod';

export const googleServiceSchema = z.enum(['gmail', 'calendar', 'tasks', 'drive', 'contacts', 'meet']);

// Something the app on the user's computer should do, like opening Gmail.
export const clientActionSchema = z.object({
  type: z.literal('open_url'),
  url: z.string(),
  label: z.string(),
});

export const pendingConfirmationSchema = z.object({
  actionId: z.string(),
  summary: z.string(),
  details: z.array(z.object({ label: z.string(), value: z.string() })),
});

export const turnRequestSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  conversationId: z.string().min(1).max(64).optional(),
});

export const turnResponseSchema = z.object({
  conversationId: z.string(),
  reply: z.string(),
  actions: z.array(clientActionSchema),
  pendingConfirmation: pendingConfirmationSchema.nullable(),
  services: z.array(googleServiceSchema),
});

export const confirmRequestSchema = z.object({
  approve: z.boolean(),
});

export const actionStatusSchema = z.enum([
  'PENDING_CONFIRMATION',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'UNDONE',
]);

export const activityItemSchema = z.object({
  id: z.string(),
  tool: z.string(),
  summary: z.string(),
  status: actionStatusSchema,
  error: z.string().nullable(),
  createdAt: z.string(),
  undoable: z.boolean(),
});

export const activityResponseSchema = z.object({
  items: z.array(activityItemSchema),
});

export const undoResponseSchema = z.object({
  reply: z.string(),
});

export type GoogleService = z.infer<typeof googleServiceSchema>;
export type ClientAction = z.infer<typeof clientActionSchema>;
export type PendingConfirmation = z.infer<typeof pendingConfirmationSchema>;
export type TurnRequest = z.infer<typeof turnRequestSchema>;
export type TurnResponse = z.infer<typeof turnResponseSchema>;
export type ConfirmRequest = z.infer<typeof confirmRequestSchema>;
export type ActionStatus = z.infer<typeof actionStatusSchema>;
export type ActivityItem = z.infer<typeof activityItemSchema>;
export type ActivityResponse = z.infer<typeof activityResponseSchema>;
export type UndoResponse = z.infer<typeof undoResponseSchema>;
