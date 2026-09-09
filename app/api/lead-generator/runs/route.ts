import { NextRequest } from 'next/server';
import { getRuns } from '@/lib/lead-generator/db/sqlite';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit')) || 50;
  return Response.json(getRuns(Math.min(Math.max(limit, 1), 200)));
}
