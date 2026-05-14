import { Hono } from 'hono';
import { getEnv } from '../lib/env.js';

const app = new Hono();

app.get('/', (c) => {
  const env = getEnv();
  return c.json({
    ok: true,
    deps: {
      anthropic: env.ANTHROPIC_API_KEY ? 'api_key' : (process.platform === 'darwin' ? 'oauth_keychain_maybe' : 'missing'),
      hunter: env.HUNTER_API_KEY ? 'configured' : 'missing',
      serpapi: env.SERPAPI_API_KEY ? 'configured' : 'missing',
      sheets: env.GOOGLE_SHEETS_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'configured' : 'missing',
    },
    model: env.LLM_MODEL,
    max_deepen_rounds: env.MAX_DEEPEN_ROUNDS,
  });
});

export default app;
