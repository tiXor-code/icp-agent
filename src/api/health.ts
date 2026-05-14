import { Hono } from 'hono';
import { getEnv } from '../lib/env.js';

const app = new Hono();

app.get('/', (c) => {
  const env = getEnv();
  return c.json({
    ok: true,
    deps: {
      azure_openai: env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_API_KEY ? 'configured' : 'missing',
      hunter: env.HUNTER_API_KEY ? 'configured' : 'missing',
      serpapi: env.SERPAPI_API_KEY ? 'configured' : 'missing',
      sheets: env.GOOGLE_SHEETS_ID && env.GOOGLE_SERVICE_ACCOUNT_JSON ? 'configured' : 'missing',
    },
    deployment: env.AZURE_OPENAI_DEPLOYMENT,
    api_version: env.AZURE_OPENAI_API_VERSION,
    max_deepen_rounds: env.MAX_DEEPEN_ROUNDS,
  });
});

export default app;
