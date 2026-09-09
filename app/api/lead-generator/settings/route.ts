import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getLGSettings,
  setSetting,
  getSetting,
  maskKey,
  upsertCustomProvider,
  deleteCustomProvider,
} from '@/lib/lead-generator/db/sqlite';
import { PROVIDER_LIST, DEFAULT_PROVIDERS } from '@/lib/lead-generator/ai/providers';
import { resolveProviderDef, envKeyFor } from '@/lib/lead-generator/ai/AIRouter';
import { ProviderId, PROVIDER_IDS, CUSTOM_PROVIDER_PREFIX, isCustomProviderId, customProviderSettingId } from '@/lib/lead-generator/types';

export const dynamic = 'force-dynamic';

const putSchema = z.object({
  provider: z.string().trim().max(60).optional(),
  model: z.string().trim().max(160).optional(),
  apiKey: z.string().trim().max(300).optional(),
  /** which provider the apiKey belongs to; defaults to `provider` or current */
  keyProvider: z.string().trim().max(60).optional(),
  clearKey: z.boolean().optional(),
  customProvider: z
    .object({
      id: z.string().trim().max(40).optional(),
      label: z.string().trim().min(1).max(60),
      baseUrl: z.string().trim().min(4).max(300).refine((u) => /^https?:\/\//.test(u), 'Base URL має починатися з http:// або https://'),
      apiKey: z.string().trim().max(300).optional(),
      defaultModel: z.string().trim().max(160).default(''),
    })
    .optional(),
  deleteCustomId: z.string().trim().max(40).optional(),
});

function buildSettingsPayload() {
  const settings = getLGSettings();

  const keys = Object.fromEntries(
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

  const customs = settings.customProviders.map((c) => ({
    id: c.id,
    label: c.label,
    baseUrl: c.baseUrl,
    defaultModel: c.defaultModel,
    maskedKey: maskKey(c.apiKey),
    hasKey: Boolean(c.apiKey),
    settingId: customProviderSettingId(c.id),
  }));

  const providers = [
    ...PROVIDER_LIST.map((p) => ({
      id: p.id,
      label: p.label,
      keyHint: p.keyHint,
      defaultModel: DEFAULT_PROVIDERS[p.id as ProviderId],
      isCustom: false,
      customId: null,
    })),
    ...customs.map((c) => ({
      id: c.settingId,
      label: c.label,
      keyHint: 'Base URL + ключ (опційно)',
      defaultModel: c.defaultModel,
      isCustom: true,
      customId: c.id,
    })),
  ];

  return { provider: settings.provider, model: settings.model, providers, keys, customs };
}

export async function GET() {
  return Response.json(buildSettingsPayload());
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
    return Response.json(
      { error: `Некоректні дані: ${parsed.error.issues.map((i) => `${i.path.join('.')} — ${i.message}`).join('; ')}` },
      { status: 400 }
    );
  }
  const data = parsed.data;

  if (data.deleteCustomId) {
    deleteCustomProvider(data.deleteCustomId);
    if (getSetting('provider') === customProviderSettingId(data.deleteCustomId)) {
      setSetting('provider', 'openrouter');
    }
    return Response.json(buildSettingsPayload());
  }

  if (data.customProvider) {
    const cp = {
      id: data.customProvider.id || Math.random().toString(36).slice(2, 10),
      label: data.customProvider.label,
      baseUrl: data.customProvider.baseUrl,
      apiKey: data.customProvider.apiKey || '',
      defaultModel: data.customProvider.defaultModel || '',
    };
    upsertCustomProvider(cp);
    if (data.provider === undefined || data.provider === '') {
      setSetting('provider', customProviderSettingId(cp.id));
      if (data.model === undefined || data.model === '') {
        setSetting('model', cp.defaultModel || getSetting('model') || '');
      }
    }
  }

  if (data.provider !== undefined && data.provider !== '') {
    const valid = PROVIDER_IDS.includes(data.provider as ProviderId) || isCustomProviderId(data.provider);
    if (!valid) {
      return Response.json({ error: 'Невідомий провайдер' }, { status: 400 });
    }
    setSetting('provider', data.provider);
  }

  if (data.model !== undefined && data.model !== '') {
    setSetting('model', data.model);
  }

  if (data.clearKey) {
    const keyProvider = data.keyProvider || data.provider;
    if (keyProvider && isCustomProviderId(keyProvider)) {
      const customId = keyProvider.slice(CUSTOM_PROVIDER_PREFIX.length);
      const cp = getLGSettings().customProviders.find((c) => c.id === customId);
      if (cp) upsertCustomProvider({ ...cp, apiKey: '' });
    } else if (keyProvider && PROVIDER_IDS.includes(keyProvider as ProviderId)) {
      setSetting(`api_key_${keyProvider}`, '');
    }
  } else if (data.apiKey !== undefined && data.apiKey !== '') {
    const keyProvider = data.keyProvider || data.provider;
    if (keyProvider && isCustomProviderId(keyProvider)) {
      const customId = keyProvider.slice(CUSTOM_PROVIDER_PREFIX.length);
      const cp = getLGSettings().customProviders.find((c) => c.id === customId);
      if (cp) upsertCustomProvider({ ...cp, apiKey: data.apiKey });
      else return Response.json({ error: 'Кастомного провайдера не знайдено' }, { status: 404 });
    } else if (keyProvider && PROVIDER_IDS.includes(keyProvider as ProviderId)) {
      setSetting(`api_key_${keyProvider}`, data.apiKey);
    }
  }

  return Response.json(buildSettingsPayload());
}
