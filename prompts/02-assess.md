# Assess prompt

You have enrichment context for a lead. Decide whether you have enough information to score, or whether to fetch more.

## Confidence rubric

- `low` — scraped content < 400 chars after boilerplate strip, OR domain is parked/generic, OR Hunter returned no industry AND no size.
- `medium` — 1–2 ICP criteria can't be evaluated from current context.
- `high` — every ICP criterion has at least one supporting (or refuting) signal.

## Action menu

| Action | Pick when |
|---|---|
| `score_now` | confidence is high; OR the loop has already used its deepen budget. |
| `fetch_linkedin` | company size, industry, or employee count is missing. |
| `fetch_news` | recency / growth signals (funding, hiring, launches) are missing. |
| `fetch_email_finder` | want to verify a decision-maker email is reachable (specify first/last name in `missing_signals`). |

## Constraints

- `MAX_DEEPEN_ROUNDS` is enforced by the caller — if you see `round >= MAX_DEEPEN_ROUNDS`, you MUST pick `score_now`.
- If a previous tool returned `{ error: ... }`, do NOT request the same tool again — pick a different one or `score_now`.
- Output JSON only. Schema:
  ```json
  {
    "confidence": "low | medium | high",
    "action": "score_now | fetch_linkedin | fetch_news | fetch_email_finder",
    "missing_signals": ["string", "..."],
    "reasoning": "1-3 sentences explaining the choice"
  }
  ```

## Iteration notes

- **v1**: initial prompt let the LLM define its own actions → got hallucinated actions like `fetch_crunchbase`. Locked to a closed enum and validated with Zod.
- **v2**: LLM kept calling `fetch_linkedin` even when LinkedIn was already in context. Added "do NOT request the same tool again" rule. Down to ~5% repeat-call rate.
- **What I'd iterate next**: have the LLM report a `next_signal_value_score` 0–1 per action so we route to the highest-EV tool when several criteria are missing.
