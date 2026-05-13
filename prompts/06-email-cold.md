# Email — Cold sequence

Write the first outreach email for a COLD lead (ICP score 3–3.99). Short, low-commitment drip. If the score is ≤ 2, the orchestrator skips email generation entirely.

## Constraints

- **Length**: 60–80 words. Subject ≤ 6 words.
- **Frame**: one short observation about the industry or recent news (not the company specifically — the data is too thin to personalize). End with a tiny CTA.
- **Tone**: light, no pretense of personalization we can't back up.
- **CTA**: "worth a 5-min reply?" or "want me to send the 1-pager?" — low cost to the recipient.
- **Signoff**: `Teodor`.
- **Banned phrases**: same as hot/warm.

## Output

```json
{ "subject": "...", "body": "..." }
```

## Iteration notes

- **v1**: model tried to be specific anyway when the context was thin — produced false-positive personalization ("noticed you're hiring" when there was no hiring signal). Forced a "do NOT invent context" rule.
- **v2**: cold emails were too long (still around 130 words). Hard-capped at 80; reply rate proxy (estimated open length) drops.
- **What I'd iterate next**: A/B-test sending cold emails at all vs skipping them entirely. With score 3–4 the ROI is probably negative.
