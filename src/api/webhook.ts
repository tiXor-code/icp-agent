import { Hono } from 'hono';
import { waitUntil } from '@vercel/functions';
import { WebhookBodySchema } from '../agent/schemas.js';
import { newLeadId } from '../lib/id.js';
import { getEnv } from '../lib/env.js';
import { log } from '../lib/log.js';
import { checkAndRecord } from '../sinks/idempotency.js';
import { appendInitial, ensureHeader } from '../sinks/sheets.js';
import { runAgent } from '../agent/run.js';

const app = new Hono();

app.post('/', async (c) => {
  const env = getEnv();

  if (env.WEBHOOK_SECRET) {
    const got = c.req.header('x-webhook-secret');
    if (got !== env.WEBHOOK_SECRET) {
      return c.json({ error: 'unauthorized' }, 401);
    }
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = WebhookBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
  }
  const { email, domain } = parsed.data;
  const lead_id = newLeadId();

  const dedup = checkAndRecord(email, domain, lead_id);
  if (dedup.dedup) {
    log().info({ existing_lead_id: dedup.lead_id, email, domain }, 'idempotency_hit');
    return c.json({ lead_id: dedup.lead_id, status: 'duplicate' }, 200);
  }

  // Best-effort header init + initial row append before responding
  await ensureHeader();
  const { row_url } = await appendInitial({ lead_id, email, domain });

  // Schedule background work
  const job = runAgent({ lead_id, email, domain }).catch((err) =>
    log().error({ err, lead_id }, 'background_agent_unhandled'),
  );

  try {
    waitUntil(job);
  } catch {
    // outside Vercel runtime — fire-and-forget
    void job;
  }

  return c.json({ lead_id, status: 'processing', sheet_row_url: row_url }, 202);
});

export default app;
