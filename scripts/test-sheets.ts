import 'dotenv/config';
import { ensureHeader, appendInitial, updateFinal } from '../src/sinks/sheets.js';
import { newLeadId } from '../src/lib/id.js';

const lead_id = newLeadId();
const email = 'demo@vercel.com';
const domain = 'vercel.com';

console.log('1. ensureHeader()');
await ensureHeader();

console.log('2. appendInitial()');
const { row_url } = await appendInitial({ lead_id, email, domain });
console.log('   row_url:', row_url);
console.log('   lead_id:', lead_id);

console.log('3. updateFinal() — mock done state');
await updateFinal({
  lead_id,
  status: 'done',
  sequence: 'hot',
  score: 8.7,
  scoring: {
    score: 8.7,
    reasoning: 'Test row from scripts/test-sheets.ts — proves Sheets credentials work end-to-end.',
    criteria_breakdown: [{ id: 'company_size', score: 2.5, weight: 2.5, evidence: 'mock' }],
  },
  email: { subject: 'Test', body: 'Hello from icp-agent.' },
  enrichment_summary: 'Mocked enrichment for credential verification.',
  deepen_actions_taken: [],
  raw_context: { lead_id, email, domain, warnings: [] },
  warnings: [],
  duration_ms: 42,
  token_usage: {},
});

console.log('Done. Open https://docs.google.com/spreadsheets/d/' + process.env.GOOGLE_SHEETS_ID + '/edit');
