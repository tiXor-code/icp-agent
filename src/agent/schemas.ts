import { z } from 'zod';

export const AssessOutputSchema = z.object({
  confidence: z.enum(['low', 'medium', 'high']),
  action: z.enum(['score_now', 'fetch_linkedin', 'fetch_news', 'fetch_email_finder']),
  missing_signals: z.array(z.string()).max(20),
  reasoning: z.string().min(1).max(800),
});
export type AssessOutput = z.infer<typeof AssessOutputSchema>;

export const CriterionScoreSchema = z.object({
  id: z.string(),
  score: z.number().min(0),
  weight: z.number().min(0),
  evidence: z.string().min(1).max(400),
});

export const ScoreOutputSchema = z.object({
  score: z.number().min(0).max(10),
  reasoning: z.string().min(1).max(800),
  criteria_breakdown: z.array(CriterionScoreSchema).min(1),
});
export type ScoreOutput = z.infer<typeof ScoreOutputSchema>;

export const EmailOutputSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(2500),
});
export type EmailOutput = z.infer<typeof EmailOutputSchema>;

export const WebhookBodySchema = z.object({
  email: z.string().email(),
  domain: z.string().min(3).max(253).regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'invalid domain'),
  source: z.string().max(120).optional(),
});
export type WebhookBody = z.infer<typeof WebhookBodySchema>;
