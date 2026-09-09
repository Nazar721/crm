import { NextRequest } from 'next/server';
import { stopRun } from '@/lib/lead-generator/runRegistry';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const stopped = stopRun(id);
  return Response.json({ stopped });
}
