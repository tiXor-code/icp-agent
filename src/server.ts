import 'dotenv/config';
import { serve } from '@hono/node-server';
import app from './index.js';
import { getEnv } from './lib/env.js';
import { log } from './lib/log.js';

const env = getEnv();
serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  log().info({ port: info.port, env: env.NODE_ENV }, 'icp_agent_listening');
});
