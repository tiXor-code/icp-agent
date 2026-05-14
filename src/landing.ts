export const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1Axj_sexUWylX8Nibg01d-Mx5xOeW7leH3Y1KdunEQW0/edit';
export const REPO_URL = 'https://github.com/tiXor-code/icp-agent';

export function landingHtml(host: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>icp-agent — autonomous lead engagement</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  :root{
    --bg:#0b0d10; --bg-2:#11151a; --fg:#e8eaed; --muted:#9aa3ad; --line:#1f262e;
    --acc:#7cd3ff; --ok:#5dd39e; --warn:#f6c177; --code-bg:#0f1419;
  }
  html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Inter,sans-serif;-webkit-font-smoothing:antialiased}
  a{color:var(--acc);text-decoration:none;border-bottom:1px solid color-mix(in oklab,var(--acc),transparent 70%)}
  a:hover{border-bottom-color:var(--acc)}
  .wrap{max-width:880px;margin:0 auto;padding:64px 24px 96px}
  h1{margin:0 0 6px;font-size:34px;letter-spacing:-.01em;font-weight:700}
  .sub{color:var(--muted);font-size:16px;margin-bottom:32px}
  .pill{display:inline-block;padding:2px 10px;border-radius:999px;background:var(--bg-2);border:1px solid var(--line);color:var(--muted);font-size:12px;margin-right:6px;vertical-align:middle}
  .ok{color:var(--ok);border-color:color-mix(in oklab,var(--ok),transparent 70%);background:color-mix(in oklab,var(--ok),transparent 92%)}
  .miss{color:var(--warn);border-color:color-mix(in oklab,var(--warn),transparent 70%);background:color-mix(in oklab,var(--warn),transparent 92%)}
  .row{display:grid;grid-template-columns:140px 1fr;gap:14px;padding:10px 0;border-top:1px solid var(--line)}
  .row:first-child{border-top:none}
  .row .k{color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.06em}
  section{margin:40px 0}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:0 0 12px;font-weight:600}
  pre{background:var(--code-bg);border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.55;margin:0}
  code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.92em;background:var(--code-bg);padding:1px 6px;border-radius:6px;border:1px solid var(--line)}
  ul{margin:0;padding-left:20px}
  li{margin:4px 0}
  .arch{background:var(--code-bg);border:1px solid var(--line);border-radius:10px;padding:14px 16px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.6;color:var(--muted);white-space:pre;overflow-x:auto}
  .links a{margin-right:18px}
  footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
  .pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 color-mix(in oklab,var(--ok),transparent 50%);animation:p 2s infinite;margin-right:6px;vertical-align:middle}
  @keyframes p{0%{box-shadow:0 0 0 0 color-mix(in oklab,var(--ok),transparent 30%)}70%{box-shadow:0 0 0 10px color-mix(in oklab,var(--ok),transparent 100%)}100%{box-shadow:0 0 0 0 color-mix(in oklab,var(--ok),transparent 100%)}}
</style>
</head>
<body>
<div class="wrap">

  <h1><span class="pulse"></span>icp-agent</h1>
  <div class="sub">Autonomous lead-engagement agent. Receives <code>{email, domain}</code>, enriches, scores against an ICP, routes Hot/Warm/Cold, drafts a personalized first email, logs every decision.</div>

  <section>
    <h2>Live status</h2>
    <div id="status-rows">
      <div class="row"><div class="k">Endpoint</div><div><span class="pill ok">live</span> <code>https://${host}</code></div></div>
      <div class="row"><div class="k">LLM</div><div id="dep-azure"><span class="pill">checking…</span></div></div>
      <div class="row"><div class="k">Enrichment</div><div id="dep-enrich"><span class="pill">checking…</span></div></div>
      <div class="row"><div class="k">Decision log</div><div id="dep-sheets"><span class="pill">checking…</span></div></div>
    </div>
  </section>

  <section>
    <h2>Try it</h2>
    <pre><code>curl -X POST https://${host}/api/webhook/inbound \\
  -H "content-type: application/json" \\
  -d '{"email":"founders@linear.app","domain":"linear.app"}'</code></pre>
    <div style="color:var(--muted);font-size:13px;margin-top:10px">
      Returns <code>202 {lead_id, sheet_row_url}</code> immediately. The background agent runs ~15s and writes a fully scored row to the
      <a href="${SHEET_URL}" target="_blank" rel="noopener">decision log</a>.
    </div>
  </section>

  <section>
    <h2>What happens to each lead</h2>
    <div class="arch">  POST /api/webhook/inbound  {email, domain}
            │
            ▼
   validate + idempotency
            │
   append placeholder row → Sheet
            │
   respond 202 {lead_id}     ← returns immediately
            │
       waitUntil(run agent)  ← background
            │
   ┌──── enrich (parallel) ────┐
   │  scrape(domain) [cheerio] │
   │  hunter.domainSearch       │
   └────────┬───────────────────┘
            │
   ┌──── LLM assess loop (bounded ReAct, ≤2 deepen rounds) ────┐
   │  action ∈ { score_now, fetch_linkedin, fetch_news,         │
   │             fetch_email_finder }                           │
   │  agent picks; code executes; context grows; loop.          │
   └────────┬───────────────────────────────────────────────────┘
            ▼
   LLM final score → {score 0-10, criteria_breakdown, reasoning}
            ▼
   route to Hot ≥8 / Warm 4-7.99 / Cold &lt;4 → LLM email
            ▼
   Sheet row → status=done with full decision chain</div>
  </section>

  <section>
    <h2>Endpoints</h2>
    <ul>
      <li><code>POST /api/webhook/inbound</code> — webhook receiver. Body <code>{email, domain, source?}</code>. Returns <code>202</code>.</li>
      <li><code>GET  /api/leads/:id</code> — fetch a single decision row by lead_id.</li>
      <li><code>GET  /api/health</code> — dep-configuration check.</li>
    </ul>
  </section>

  <section class="links">
    <h2>Links</h2>
    <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub repo</a>
    <a href="${SHEET_URL}" target="_blank" rel="noopener">Decision log (Google Sheet)</a>
    <a href="/api/health" target="_blank" rel="noopener">/api/health</a>
  </section>

  <footer>
    <div>TypeScript · Hono · Azure OpenAI (gpt-4o-mini) · Hunter.io · SerpAPI · Google Sheets</div>
    <div style="margin-top:6px">Built as a take-home assignment. See <a href="${REPO_URL}/blob/main/README.md">README</a> for ICP criteria, decision logic, prompts, and what I'd iterate on.</div>
  </footer>
</div>

<script>
  fetch('/api/health').then(r => r.json()).then(j => {
    const d = j.deps || {};
    const pill = (state, label) => '<span class="pill ' + (state==='configured'?'ok':'miss') + '">' + (state==='configured' ? 'configured' : 'missing') + '</span> ' + label;
    document.getElementById('dep-azure').innerHTML = pill(d.azure_openai, '<code>azure_openai</code> · <span style="color:var(--muted)">' + (j.deployment || '') + ' · ' + (j.api_version || '') + '</span>');
    const enrichOk = (d.hunter==='configured' && d.serpapi==='configured') ? 'configured' : 'missing';
    document.getElementById('dep-enrich').innerHTML = pill(enrichOk, '<code>hunter</code> · <code>serpapi</code>');
    document.getElementById('dep-sheets').innerHTML = pill(d.sheets, '<code>google_sheets</code>');
  }).catch(() => {
    document.getElementById('dep-azure').innerHTML = '<span class="pill miss">unreachable</span>';
  });
</script>

</body>
</html>`;
}
