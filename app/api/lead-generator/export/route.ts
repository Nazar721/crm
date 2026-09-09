import { NextRequest } from 'next/server';
import { getLeads } from '@/lib/lead-generator/db/sqlite';
import { leadsToCsv, leadsToJson } from '@/lib/lead-generator/csv';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const runIdParam = searchParams.get('runId');
  const format = searchParams.get('format') === 'json' ? 'json' : 'csv';

  const leads = getLeads({
    runId: runIdParam !== null ? Number(runIdParam) || undefined : undefined,
  });

  if (leads.length === 0) {
    return new Response('No leads to export', { status: 404 });
  }

  const date = new Date().toISOString().split('T')[0];

  if (format === 'json') {
    return new Response(leadsToJson(leads), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads_${date}.json"`,
      },
    });
  }

  return new Response(leadsToCsv(leads), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="leads_${date}.csv"`,
    },
  });
}
