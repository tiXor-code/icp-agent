# Score prompt

Apply the ICP rubric from the system prompt to the enrichment context. Return a JSON object — no prose, no markdown.

## Required output

```json
{
  "score": 7.4,
  "reasoning": "2-4 sentences explaining the aggregate score and the strongest 1-2 signals driving it.",
  "criteria_breakdown": [
    {
      "id": "company_size",
      "score": 2.0,
      "weight": 2.5,
      "evidence": "Hunter reports size 51-200; LinkedIn snippet confirms ~80 employees."
    },
    ...
  ]
}
```

## Rules

- `score` must equal the sum of `criteria_breakdown[*].score`, rounded to 1 decimal.
- Each criterion's `score` must be in `[0, weight]`.
- `evidence` must reference an actual field in the provided context (e.g. `hunter.size`, `scrape.tech_signals`, `news.snippets[0].title`). Don't invent data.
- If a criterion has no supporting evidence at all, score it `0` and write `evidence: "no signal in available context"`.

## Iteration notes

- **v1**: didn't enforce that `score == sum(criteria_breakdown)`. The LLM was returning aggregate scores that didn't match the breakdown. Added the rule + numerical post-check.
- **v2**: evidence strings were vague ("looks like a SaaS"). Added "must reference an actual field" → evidence quality jumped, makes the Sheet logs auditable.
- **What I'd iterate next**: ask the LLM to output a `confidence` per criterion too, so we can flag rows where the score is high but the underlying evidence is weak.
