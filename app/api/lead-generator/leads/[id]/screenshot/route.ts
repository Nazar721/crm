import { NextRequest } from 'next/server';
import fs from 'fs';
import { getLeadById } from '@/lib/lead-generator/db/sqlite';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lead = getLeadById(Number(id));
  if (!lead || !lead.screenshotPath) {
    return new Response('Screenshot not found', { status: 404 });
  }

  try {
    const file = fs.readFileSync(lead.screenshotPath);
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response('Screenshot not found', { status: 404 });
  }
}
