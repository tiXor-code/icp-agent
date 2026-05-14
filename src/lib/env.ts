import { z } from 'zod';

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('claude-sonnet-4-6'),
  HUNTER_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
  GOOGLE_SHEETS_ID: z.string().optional(),
  GOOGLE_SHEETS_TAB: z.string().default('Leads'),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  MAX_DEEPEN_ROUNDS: z.coerce.number().int().min(0).max(5).default(2),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Reset for tests. */
export function resetEnv(): void {
  cached = null;
}
