export const config = { runtime: 'nodejs' };

export default function handler(req: Request) {
  return new Response(JSON.stringify({ ok: true, ts: Date.now() }), {
    headers: { 'content-type': 'application/json' },
  });
}
