import { Hono } from 'hono';
import webhook from './api/webhook.js';
import health from './api/health.js';
import leads from './api/leads.js';
import { landingHtml } from './landing.js';

const app = new Hono();

app.get('/', (c) => {
  // Serve JSON to clients that explicitly want JSON (curl -H accept: application/json),
  // HTML landing page to browsers.
  const accept = c.req.header('accept') ?? '';
  if (accept.includes('application/json') && !accept.includes('text/html')) {
    return c.json({
      name: 'icp-agent',
      endpoints: ['/api/health', 'POST /api/webhook/inbound', 'GET /api/leads/:id'],
    });
  }
  const host = c.req.header('host') ?? 'icp-agent-ten.vercel.app';
  return c.html(landingHtml(host));
});

app.route('/api/health', health);
app.route('/api/webhook/inbound', webhook);
app.route('/api/leads', leads);

export default app;
