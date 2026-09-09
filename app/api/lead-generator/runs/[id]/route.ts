import { NextRequest } from 'next/server';
import { getRunById, getLeads } from '@/lib/lead-generator/db/sqlite';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) {
    return Response.json({ error: 'Invalid run id' }, { status: 400 });
  }
  const run = getRunById(runId);
  if (!run) {
    return Response.json({ error: 'Run not found' }, { status: 404 });
  }
  const leads = getLeads({ runId });
  return Response.json({ run, leads });
}
