import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.SCHEDULER_API_URL ?? 'http://localhost:3000';

/**
 * POST /api/schedule
 * Proxy vers l'API Express. Utilise un Route Handler (plutôt qu'un rewrite)
 * pour éviter le timeout du proxy Next.js sur les longues computations.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.arrayBuffer();

    const response = await fetch(`${API_BASE}/api/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Connection': 'close' },
      body,
      signal: AbortSignal.timeout(300_000), // 5 min max
    });

    const data = await response.arrayBuffer();
    return new NextResponse(data, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
