import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts');

function load(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), 'utf8');
}

export const SYSTEM_PROMPT = load('01-system-icp.md');
export const ASSESS_PROMPT = load('02-assess.md');
export const SCORE_PROMPT = load('03-score.md');
export const EMAIL_PROMPTS = {
  hot: load('04-email-hot.md'),
  warm: load('05-email-warm.md'),
  cold: load('06-email-cold.md'),
} as const;
