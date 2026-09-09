import { NextRequest } from 'next/server';
import { getLeads } from '@/lib/lead-generator/db/sqlite';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const runIdParam = searchParams.get('runId');
  const status = searchParams.get('status') || undefined;

  const leads = getLeads({
    runId: runIdParam !== null ? Number(runIdParam) || undefined : undefined,
    status: status || undefined,
  });

  return Response.json(leads);
}
