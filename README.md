# icp-agent

An autonomous lead-engagement agent. Receives `{email, domain}` webhooks, enriches the lead, **decides whether to research more**, scores against an ICP, routes into Hot / Warm / Cold sequences, and drafts a personalized opening email. Every decision is logged to a Google Sheet.

Built with TypeScript + [Hono](https://hono.dev) + the Anthropic SDK (`claude-sonnet-4-6`) + Hunter.io + SerpAPI. Deployable to Vercel; runs locally with one command.

---

## Quick start (local)

```bash
git clone <this-repo>
cd icp-agent
npm install
cp .env.example .env       # fill in the keys below

npm test                   # 15 unit tests
npm run dev                # http://localhost:3000

# In another terminal:
npm run seed payload-rich
# → 202 { lead_id, status: 'processing', sheet_row_url }
# Watch the Google Sheet — row should fill in ~20s.
```

Three seed payloads ship in `seed/`:
- `payload.json` — vercel.com (rich data, fast path)
- `payload-rich.json` — linear.app (rich data, expected `score >= 8`, hot)
- `payload-sparse.json` — a fake parked domain (forces the agentic deepen loop)

## Live demo

> **Live URL**: https://icp-agent-ten.vercel.app
>
> **Decision log (Google Sheet)**: pending org-policy unblock; falls back to local `/tmp/icp-agent-sheet-buffer.jsonl` until configured.

POST a sample to the live URL:
```bash
curl -X POST https://icp-agent-ten.vercel.app/api/webhook/inbound \
  -H "content-type: application/json" \
  -d '{"email":"founders@linear.app","domain":"linear.app"}'
# → 202 { "lead_id": "...", "status": "processing", "sheet_row_url": ... }
```

Status check:
```bash
curl https://icp-agent-ten.vercel.app/api/leads/<lead_id>
curl https://icp-agent-ten.vercel.app/api/health
```

---

## What the agent does

```
   POST /api/webhook/inbound  {email, domain}
              │
              ▼
       validate (Zod) + idempotency
              │
       append placeholder row → Sheet (status=processing)
              │
       respond 202 {lead_id}      ← returns immediately
              │
       waitUntil(run agent)       ← background work
              │
       ┌──── ENRICH (parallel) ────┐
       │  scrape(domain) [cheerio] │
       │  hunter.domainSearch       │
       └────────┬───────────────────┘
                │
       ┌──── ASSESS LOOP (bounded ReAct, ≤ 2 deepen rounds) ───┐
       │  LLM picks one action from a closed enum:              │
       │    score_now | fetch_linkedin | fetch_news |           │
       │    fetch_email_finder                                  │
       │  Tool result is appended to context; loop again.       │
       └────────┬───────────────────────────────────────────────┘
                ▼
       LLM final SCORE → {score, criteria_breakdown, reasoning}
                ▼
       Route to Hot / Warm / Cold band → LLM EMAIL (one of 3 prompts)
                ▼
       Sheet row updated to status=done with full decision chain.
       Errors mid-flight → status=failed with partial context retained.
```

Total: **2 enrichment calls (parallel) + 1-3 LLM assess calls + 1 LLM score call + 1 LLM email call**.
Anthropic prompt caching keeps the ICP system prompt free across calls.

---

## ICP criteria (and why)

Target: a generic B2B SaaS / dev-tools vendor. Six criteria, weighted to sum to 10.

| # | Criterion | Weight | Why it matters |
|---|---|---|---|
| 1 | Company size 10–200 employees | **2.5** | SMB sweet spot: enough budget to buy, fast enough to decide. <10 = no budget; >200 = procurement death. |
| 2 | Industry fit | **2.0** | We sell into SaaS, dev-tools, e-commerce, agencies, fintech. Government and brick-and-mortar are anti-segments. |
| 3 | Geography (English-speaking) | **1.0** | First-touch English is cheaper than translated outreach. Lighter weight because it's a feasibility filter, not a fit signal. |
| 4 | Tech-stack modernity | **1.5** | Modern stack (Next.js / Vercel / Stripe / Segment) correlates strongly with "product-thinking team," our best fit. |
| 5 | Growth signals | **1.5** | Recent blog / changelog / hiring / funding shows the team is moving — buyers move when they're moving. Stale = procurement freeze. |
| 6 | Buyer reachability | **1.5** | If Hunter can't find a single decision-maker email, our cost-to-engage skyrockets. |

Each criterion produces `{score: 0..weight, evidence: string}`. Aggregate score is the sum.

**Band routing**:
- `score >= 8` → **Hot**: highly personalized founder-style email
- `score >= 4 && < 8` → **Warm**: problem-led standard nurture
- `score < 4` → **Cold**: short generic touch (skipped entirely if `score <= 2`)

The source of truth is [`src/agent/icp.ts`](src/agent/icp.ts) — same constants used by the system prompt, the scoring schema, and the tests (`tests/unit/icp.test.ts` asserts the weights sum to 10).

---

## Agentic decision logic — when does the agent seek more info?

The agent is a **bounded ReAct loop**, implemented in [`src/agent/run.ts`](src/agent/run.ts):

```ts
const ctx = { scrape: await scrape(domain), hunter: await hunter.domainSearch(domain) };

for (let round = 0; round <= MAX_DEEPEN_ROUNDS; round++) {
  const decision = await llm.assess(ctx, round, MAX_DEEPEN_ROUNDS);
  if (decision.action === 'score_now' || round === MAX_DEEPEN_ROUNDS) break;
  ctx[decision.action] = await tools[decision.action](domain, ctx);   // append context, loop
}

const scoring = await llm.score(ctx);
const sequence = bandFromScore(scoring.score);
const email = await llm.email(ctx, scoring, sequence);
```

### How the LLM decides

The assess prompt ([`prompts/02-assess.md`](prompts/02-assess.md)) gives the model a closed action menu plus a confidence rubric:

- **Mark `confidence: low`** when scraped content < 400 chars after boilerplate strip, OR domain looks parked, OR Hunter returned no industry AND no size.
- **Mark `confidence: medium`** when 1–2 ICP criteria can't be evaluated from current context.
- **Mark `confidence: high`** only when every ICP criterion has at least one supporting (or refuting) signal.

Action menu:

| Action | Tool | Picked when |
|---|---|---|
| `score_now` | none | confidence is high; or `round === MAX_DEEPEN_ROUNDS` (forced by the loop) |
| `fetch_linkedin` | SerpAPI Google search `"<company> site:linkedin.com/company"` | size, industry, or employee count is missing |
| `fetch_news` | SerpAPI Google news in last 90 days | recency / growth signals (funding, hiring, launches) missing |
| `fetch_email_finder` | Hunter `email-finder` | want to confirm a specific decision-maker email exists |

### Hard guarantees the code enforces

- **Bounded**: `MAX_DEEPEN_ROUNDS = 2` (configurable via env). Total LLM calls per lead ≤ 4 (3 assess + 1 score + 1 email).
- **Closed action set**: Zod-validated. The LLM cannot invent new tool names.
- **No infinite-tool-loop**: if a previous tool returned an error, the prompt instructs the LLM to pick a different one (and a test confirms warnings get logged).
- **Cache cost**: the ICP system prompt is sent with `cache_control: { type: 'ephemeral' }` — reused across the 3-5 LLM calls per lead for free after the first one.

### Why ReAct over free-form tool-use

I considered giving Claude raw `tool_use` blocks and letting it call APIs directly. I rejected that because:
1. Tool-use loops are harder to bound — the model can chain 10+ calls if you're not careful.
2. Closed-enum actions are trivially testable with mocked LLM responses (see `tests/unit/agent-decisions.test.ts`).
3. The README can document exactly what the agent can and can't do.

The trade-off: less expressive, but far more defensible.

---

## External APIs

| API | Purpose | Free tier | Failure handling |
|---|---|---|---|
| **Anthropic** (`claude-sonnet-4-6`) | Assess, score, email | Pay-as-you-go ($) | 1 retry with repair-prompt on malformed JSON; full failure → `status: failed`. |
| **Hunter.io** `domain-search` | Company firmographics + emails | 25/mo | 429 → recorded as `hunter:rate_limited`; agent likely picks `fetch_linkedin`. |
| **Hunter.io** `email-finder` | Verify exec emails | 25/mo (shared) | Same as above. |
| **SerpAPI** Google search | LinkedIn + news lookups | 100/mo | 429 → recorded as warning; loop forces `score_now`. |
| **Google Sheets API** | Decision log | Free | Buffered to `/tmp/icp-agent-sheet-buffer.jsonl`; flush on next success. |

The website scrape uses **plain `fetch` + cheerio** — no external API, no rate limit. It extracts: title, description, scraped text (4KB cap), tech-stack signatures (Next.js, React, Vercel, Stripe, Segment, WordPress, …), social links, emails, hiring-page hints, and blog links.

---

## Failure modes — exhaustively handled

| Failure | Behavior |
|---|---|
| Webhook body invalid | 400 with Zod issue list. Not logged to Sheet. |
| Duplicate `(email, domain)` within 60s | 200 with original `lead_id`. SHA-256 idempotency key in memory. |
| Hunter 429 / 401 / 5xx | Empty `HunterCompany` with `error: 'rate_limited'`. Logged as warning. Agent's assess prompt is told to compensate via LinkedIn lookup. |
| Hunter returns 0 emails | Valid empty input — LLM marks confidence `low` and likely picks `fetch_email_finder` or `fetch_linkedin`. |
| Website unreachable (timeout, 4xx, 5xx) | `ScrapeResult { error, partial: {} }`. Agent continues; will likely deepen. |
| Anthropic 5xx | One retry with backoff. Second failure → `status: failed`, partial context retained in Sheet. |
| LLM returns malformed JSON | Zod fails → 1 repair retry with the previous response shown. Second failure → `status: failed`. |
| Google Sheets API down | Buffered to local JSONL. Append + update both fall back. Sheet flush is a documented manual recovery step. |
| Vercel function killed mid-run | Row stays at `status: processing`. This is a known limitation of `waitUntil` on Hobby plan (60s ceiling). Production fix: Vercel Workflow DevKit. |
| Webhook hit while `WEBHOOK_SECRET` is set | 401 if header missing or wrong. |
| Cold lead with `score <= 2` | Email generation is **skipped** entirely; row gets `warnings: cold_skipped`. |

Every non-fatal issue lands in the Sheet's `warnings` column so a reviewer can grep them later.

---

## Decision-log schema (Google Sheets)

One row per lead in the `Leads` tab. Columns:

```
A  timestamp_utc                ISO 8601
B  lead_id                      nanoid 12 chars
C  email                        raw input
D  domain                       raw input
E  status                       processing | done | failed
F  sequence                     hot | warm | cold | (empty)
G  score                        0.0 .. 10.0
H  scoring_reasoning            LLM text
I  criteria_breakdown_json      per-criterion JSON
J  enrichment_summary           short summary of scrape+hunter highlights
K  deepen_actions_taken         comma-list of tools the agent chose to invoke
L  email_subject
M  email_body
N  raw_context_json             everything the LLM saw (truncated to 50KB)
O  warnings                     comma-list of non-fatal issues
P  error_message                if status = failed
Q  duration_ms
R  token_usage_json             per-LLM-call usage incl. cache stats
```

---

## Endpoints

```
POST /api/webhook/inbound        { email, domain, source? } → 202 { lead_id, sheet_row_url }
GET  /api/leads/:id              → { ...row, status }  or 404
GET  /api/health                 → { ok, deps: { anthropic, hunter, serpapi, sheets } }
```

---

## Repo layout

```
icp-agent/
├── README.md                          ← you are here
├── prompts/                           ← reviewer-readable prompt copies
│   ├── 01-system-icp.md
│   ├── 02-assess.md
│   ├── 03-score.md
│   ├── 04-email-hot.md
│   ├── 05-email-warm.md
│   └── 06-email-cold.md
├── seed/
│   ├── payload.json
│   ├── payload-rich.json
│   └── payload-sparse.json
├── (Vercel auto-detects Hono preset and deploys src/index.ts)
├── src/
│   ├── server.ts                      ← local dev entry
│   ├── index.ts                       ← Hono app composition
│   ├── api/{webhook,health,leads}.ts
│   ├── agent/
│   │   ├── run.ts                     ← orchestrator (ReAct loop)
│   │   ├── icp.ts                     ← ICP criteria source of truth
│   │   ├── schemas.ts                 ← Zod schemas for LLM outputs
│   │   ├── llm.ts                     ← Anthropic wrapper w/ caching + repair retry
│   │   ├── prompts.ts                 ← compiled prompt loader
│   │   └── tools/
│   │       ├── scrape.ts              ← fetch + cheerio
│   │       ├── hunter.ts              ← domain-search + email-finder
│   │       └── serpapi.ts             ← linkedin + news
│   ├── sinks/
│   │   ├── sheets.ts                  ← append + updateById + local buffer
│   │   └── idempotency.ts             ← sha256 dedup
│   ├── lib/
│   │   ├── env.ts                     ← zod-validated env loader
│   │   ├── id.ts                      ← nanoid + sha256
│   │   └── log.ts                     ← pino
│   └── types.ts
├── scripts/seed.ts                    ← curl helper
└── tests/
    └── unit/
        ├── icp.test.ts
        ├── scrape.test.ts
        └── agent-decisions.test.ts    ← branching: score_now, deepen, cap, cold-skip
```

---

## Deploy to Vercel

```bash
vercel link
# Set each env var (interactive):
vercel env add ANTHROPIC_API_KEY production
vercel env add HUNTER_API_KEY production
vercel env add SERPAPI_API_KEY production
vercel env add GOOGLE_SHEETS_ID production
vercel env add GOOGLE_SERVICE_ACCOUNT_JSON production   # base64-encoded JSON key
vercel env add LLM_MODEL production                     # claude-sonnet-4-6
vercel env add MAX_DEEPEN_ROUNDS production             # 2
# Optional:
vercel env add WEBHOOK_SECRET production
vercel --prod
```

---

## What I'd improve with more time

1. **Vercel Workflow DevKit instead of `waitUntil`** — durable workflows that survive function-kill, with proper retries and step-level visibility. The current `waitUntil` approach can lose a row if the function times out.
2. **Real tool-use mode as an opt-in** — let Claude call tools directly via `tool_use` blocks for cases where the closed-enum is too restrictive (e.g. "find this specific exec's role via news → then email-finder them").
3. **Few-shot examples in email prompts** — current emails are zero-shot. With 3 examples of high-reply-rate emails per band, output quality jumps.
4. **Confidence-weighted scoring** — have the LLM emit a per-criterion confidence (0-1) alongside the score; downweight low-confidence criteria. Surfaces "high score but flimsy evidence" rows.
5. **Per-domain rate limit** — currently nothing stops the same domain being hit 100 times/hour with different emails. SHA-256 idempotency only covers exact duplicates within 60s.
6. **Real test Supabase** instead of Google Sheets when scale grows — Sheets API has a 60 requests/min/user cap.
7. **A/B test cold sends vs cold skips** — current code generates emails for score 3-3.99. Probably negative ROI.
8. **Vertical-specific ICP overrides** — pass `?icp=fintech` and load a different criteria set. Foundation is already there since `ICP_CRITERIA` is a single array.
9. **Replay / re-score** — keep `raw_context_json` immutable in the Sheet so a future scorer can re-score historical leads against a new ICP.
10. **Eval harness** — small `evals/` dir with labeled examples (score, sequence, expected deepen actions) and a CI job that runs the agent against them on every prompt change.

---

## License

MIT.
