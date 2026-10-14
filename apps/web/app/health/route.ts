// Liveness: 200 while the Next.js server can serve requests. Never touches dependencies.
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
