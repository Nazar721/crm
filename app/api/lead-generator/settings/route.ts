import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getLGSettings, setSetting, getSetting, maskKey } from '@/lib/lead-generator/db/sqlite';
import { PROVIDER_LIST, DEFAULT_PROVIDERS } from '@/lib/lead-generator/ai/providers';
import { resolveProviderDef, envKeyFor } from '@/lib/lead-generator/ai/AIRouter';
import { ProviderId, PROVIDER_IDS } from '@/lib/lead-generator/types';

export const dynamic = 'force-dynamic';

const putSchema = z.object({
  provider: z.string().trim().max(40).optional(),
  model: z.string().trim().max(160).optional(),
  apiKey: z.string().trim().max(300).optional(),
  /** which provider the apiKey belongs to; defaults to `provider` or current */
  keyProvider: z.string().trim().max(40).optional(),
  clearKey: z.boolean().optional(),
});

function keyStatuses() {
  const settings = getLGSettings();
  return Object.fromEntries(
    PROVIDER_IDS.map((id) => {
      const stored = getSetting(`api_key_${id}`);
      return [
        id,
        {
          masked: maskKey(settings.keys[id]),
          hasKey: Boolean(settings.keys[id]),
          fromEnv: !stored && Boolean(envKeyFor(resolveProviderDef(id))),
        },
      ];
    })
  );
}

export async function GET() {
  const settings = getLGSettings();
  return Response.json({
    provider: settings.provider,
    model: settings.model,
    providers: PROVIDER_LIST.map((p) => ({
      id: p.id,
      label: p.label,
      keyHint: p.keyHint,
      defaultModel: DEFAULT_PROVIDERS[p.id],
    })),
    keys: keyStatuses(),
  });
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: 'Invalid payload' }, { status: 400 });
  }
  const data = parsed.data;

  const current = getLGSettings();

  let targetProvider: ProviderId = current.provider;
  if (data.provider !== undefined && data.provider !== '') {
    if (!PROVIDER_IDS.includes(data.provider as ProviderId)) {
      return Response.json({ error: 'Unknown provider' }, { status: 400 });
    }
    targetProvider = data.provider as ProviderId;
    setSetting('provider', data.provider);
  }

  if (data.model !== undefined && data.model !== '') {
    setSetting('model', data.model);
  }

  if (data.clearKey) {
    const keyProvider = data.keyProvider && PROVIDER_IDS.includes(data.keyProvider as ProviderId)
      ? (data.keyProvider as ProviderId)
      : targetProvider;
    setSetting(`api_key_${keyProvider}`, '');
  } else if (data.apiKey !== undefined && data.apiKey !== '') {
    const keyProvider = data.keyProvider && PROVIDER_IDS.includes(data.keyProvider as ProviderId)
      ? (data.keyProvider as ProviderId)
      : targetProvider;
    setSetting(`api_key_${keyProvider}`, data.apiKey);
  }

  const updated = getLGSettings();
  return Response.json({
    provider: updated.provider,
    model: updated.model,
    keys: keyStatuses(),
  });
}
