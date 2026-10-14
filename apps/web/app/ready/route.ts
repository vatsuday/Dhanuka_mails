// Readiness. The web app has no direct database or Valkey connection (the browser reaches the API
// through the same-origin /api rewrite), so it has no dependency checks yet; the shape matches the
// /ready response of the other apps.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ready', checks: [] }, { headers: { 'cache-control': 'no-store' } });
}
