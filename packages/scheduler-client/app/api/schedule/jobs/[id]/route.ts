import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.SCHEDULER_API_URL ?? 'http://localhost:3000';

/**
 * GET /api/schedule/jobs/[id]
 * Proxy vers l'API Express pour le polling du statut d'un job.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const response = await fetch(`${API_BASE}/api/schedule/jobs/${id}`);
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

/**
 * DELETE /api/schedule/jobs/[id]
 * Proxy vers l'API Express pour l'annulation/suppression d'un job.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const response = await fetch(`${API_BASE}/api/schedule/jobs/${id}`, {
      method: 'DELETE',
    });
    return new NextResponse(null, { status: response.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
