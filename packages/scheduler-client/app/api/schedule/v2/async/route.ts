import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.SCHEDULER_API_URL ?? 'http://localhost:3000';

/**
 * POST /api/schedule/v2/async
 * Proxy vers l'API Express pour la soumission de jobs asynchrones.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.arrayBuffer();
    const clientId = req.headers.get('x-client-id') ?? '';

    const response = await fetch(`${API_BASE}/api/schedule/v2/async`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': clientId,
      },
      body,
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
