import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getLGSettings, maskKey } from '@/lib/lead-generator/db/sqlite';
import { MultiProvider } from '@/lib/lead-generator/ai/MultiProvider';
import { ProviderError } from '@/lib/lead-generator/ai/ProviderError';
import { resolveProviderDef, envKeyFor } from '@/lib/lead-generator/ai/AIRouter';
import { DEFAULT_PROVIDERS } from '@/lib/lead-generator/ai/providers';
import { ProviderId, PROVIDER_IDS, isCustomProviderId } from '@/lib/lead-generator/types';

export const dynamic = 'force-dynamic';

// 10-minute in-memory cache per provider to avoid hammering /models on every page load
interface ModelsCacheEntry {
  at: number;
  models: { id: string; label?: string }[];
}

interface ModelsCacheHost {
  __lgModelsCache?: Map<string, ModelsCacheEntry>;
}

const CACHE_TTL = 10 * 60 * 1000;
const cacheHost = globalThis as ModelsCacheHost;
const cache = cacheHost.__lgModelsCache ?? new Map<string, ModelsCacheEntry>();
cacheHost.__lgModelsCache = cache;

const querySchema = z.object({
  provider: z.string().optional(),
  refresh: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  const settings = getLGSettings();
  const providerRaw = parsed.success ? parsed.data.provider : undefined;
  const providerId = providerRaw || settings.provider;
  const refresh = parsed.success && parsed.data.refresh === '1';

  const def = resolveProviderDef(providerId, settings.customProviders);
  let apiKey = '';
  if (isCustomProviderId(def.id)) {
    apiKey = settings.customProviders.find((c) => `custom-${c.id}` === def.id)?.apiKey || '';
  } else {
    apiKey = settings.keys[def.id as ProviderId] || envKeyFor(def) || '';
  }

  const fallbackModels = def.defaultModel ? [{ id: def.defaultModel }] : [];

  if (!apiKey && def.envKey) {
    return Response.json({
      provider: providerId,
      hasApiKey: false,
      models: fallbackModels,
      defaultModel: def.defaultModel || '',
      source: 'fallback',
      error: `API-ключ ${def.label} не налаштований`,
    });
  }

  const cached = cache.get(providerId);
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL) {
    return Response.json({
      provider: providerId,
      hasApiKey: Boolean(apiKey),
      maskedApiKey: maskKey(apiKey),
      models: cached.models,
      defaultModel: def.defaultModel || '',
      source: 'cache',
    });
  }

  try {
    const impl = new MultiProvider(def);
    const models = await impl.listModels(apiKey);
    if (models.length === 0) throw new ProviderError(502, 'Порожній список моделей');
    cache.set(providerId, { at: Date.now(), models });
    return Response.json({
      provider: providerId,
      hasApiKey: Boolean(apiKey),
      maskedApiKey: maskKey(apiKey),
      models,
      defaultModel: def.defaultModel || '',
      source: 'live',
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    console.error(`[lead-generator] listModels(${providerId}) failed:`, err);
    return Response.json({
      provider: providerId,
      hasApiKey: Boolean(apiKey),
      maskedApiKey: maskKey(apiKey),
      models: fallbackModels,
      defaultModel: def.defaultModel || '',
      source: 'fallback',
      error: `Не вдалося завантажити моделі з ${def.label} (${err instanceof Error ? err.message.slice(0, 120) : 'помилка'})`,
    });
  }
}
