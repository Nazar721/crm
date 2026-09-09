import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getLeadById, updateLeadMeta } from '@/lib/lead-generator/db/sqlite';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  status: z.enum(['new', 'in-progress', 'contacted', 'won', 'excluded']).optional(),
  notes: z.string().max(5000).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const lead = getLeadById(Number(id));
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 });
  return Response.json(lead);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const leadId = Number(id);
  if (!Number.isInteger(leadId)) {
    return Response.json({ error: 'Invalid lead id' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const lead = updateLeadMeta(leadId, parsed.data);
  if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404 });
  return Response.json(lead);
}
