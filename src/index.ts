import { Hono } from 'hono';
import webhook from './api/webhook.js';
import health from './api/health.js';
import leads from './api/leads.js';

const app = new Hono();

app.get('/', (c) => c.json({ name: 'icp-agent', endpoints: ['/api/health', 'POST /api/webhook/inbound', 'GET /api/leads/:id'] }));
app.route('/api/health', health);
app.route('/api/webhook/inbound', webhook);
app.route('/api/leads', leads);

export default app;
