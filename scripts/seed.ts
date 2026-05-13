import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const target = process.env.SEED_URL ?? 'http://localhost:3000/api/webhook/inbound';
const which = process.argv[2] ?? 'payload';   // payload | payload-sparse | payload-rich
const file = join(__dirname, '..', 'seed', `${which}.json`);

const body = JSON.parse(readFileSync(file, 'utf8'));

const headers: Record<string, string> = { 'content-type': 'application/json' };
if (process.env.WEBHOOK_SECRET) headers['x-webhook-secret'] = process.env.WEBHOOK_SECRET;

const res = await fetch(target, { method: 'POST', headers, body: JSON.stringify(body) });
const json = await res.json();
console.log(`POST ${target} → ${res.status}`);
console.log(JSON.stringify(json, null, 2));
