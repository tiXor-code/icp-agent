# Email — Hot sequence

Write the first outreach email for a HOT lead (ICP score ≥ 8). High-touch, founder-style.

## Constraints

- **Length**: 80–120 words in `body`. Subject ≤ 8 words.
- **Specificity**: reference at least 2 concrete observations from the enrichment context (a tech-stack choice, a recent news item, a hiring signal, a specific page). Quote them lightly — never paste raw JSON.
- **Tone**: warm, peer-to-peer, no "Just wanted to reach out". Imagine you wrote it yourself between meetings.
- **CTA**: one soft ask — a 15-minute call, or a single specific question. No double-CTA, no "Looking forward to hearing from you."
- **Signoff**: a real first name (use `Teodor`). No corporate sign-off.
- **Banned phrases**: "I hope this finds you well", "circle back", "synergy", "leverage", "delve", "I'd love to learn more". (These trigger spam filters and read like AI slop.)

## Output

```json
{ "subject": "...", "body": "..." }
```

## Iteration notes

- **v1**: model kept opening with "I noticed you're using Next.js" — too on-the-nose, sounds scrape-y. Rewrote prompt to ask for "lightly quoted" references that feel observational.
- **v2**: subject lines were generic ("Quick question"). Added "≤ 8 words, no question marks" — got punchier hooks like "Your hiring page caught my eye".
- **What I'd iterate next**: feed in 3 examples of high-performing real emails as few-shot; current version is zero-shot.
