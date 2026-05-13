import { Hono } from 'hono';
import { findByLeadId, HEADER_COLUMNS } from '../sinks/sheets.js';

const app = new Hono();

app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await findByLeadId(id);
  if (!row) return c.json({ error: 'not_found' }, 404);
  const obj: Record<string, string> = {};
  HEADER_COLUMNS.forEach((col, i) => {
    obj[col] = String(row[i] ?? '');
  });
  return c.json(obj);
});

export default app;
