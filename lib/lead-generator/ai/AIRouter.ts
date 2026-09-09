import { CustomProvider, isCustomProviderId, customProviderSettingId } from '../types';
import { AIProvider, GenerateOptions, ProviderDefinition, PROVIDERS, DEFAULT_PROVIDERS } from './providers';
import { customProviderToDef } from './providers';
import { MultiProvider } from './MultiProvider';
import { ProviderError } from './ProviderError';

const implCache = new Map<string, AIProvider>();

function getImpl(def: ProviderDefinition): AIProvider {
  let impl = implCache.get(def.id);
  if (!impl) {
    impl = new MultiProvider(def);
    implCache.set(def.id, impl);
  }
  return impl;
}

export function resolveProviderDef(
  provider: string | undefined,
  customProviders: CustomProvider[] = []
): ProviderDefinition {
  if (provider) {
    if (isCustomProviderId(provider)) {
      const customId = provider.slice('custom-'.length);
      const cp = customProviders.find((c) => c.id === customId);
      if (cp) return customProviderToDef(cp);
    } else if (provider in PROVIDERS) {
      return PROVIDERS[provider as keyof typeof PROVIDERS];
    }
  }
  return PROVIDERS.openrouter;
}

export function envKeyFor(def: ProviderDefinition): string {
  return def.envKey ? process.env[def.envKey] || '' : '';
}

export function apiKeyForProvider(
  provider: string | undefined,
  settings: { keys: Record<string, string>; customProviders: CustomProvider[] }
): string {
  const def = resolveProviderDef(provider, settings.customProviders);
  if (isCustomProviderId(def.id)) {
    const customId = def.id.slice('custom-'.length);
    const cp = settings.customProviders.find((c) => c.id === customId);
    return cp?.apiKey || '';
  }
  return settings.keys[def.id as keyof typeof settings.keys] || envKeyFor(def);
}

export class AIRouter {
  async isAvailable(provider: string, apiKey?: string): Promise<boolean> {
    const def = resolveProviderDef(provider);
    if (isCustomProviderId(def.id)) return Boolean(apiKey || def.baseUrl);
    return Boolean(apiKey || envKeyFor(def));
  }

  async generateWithFallbacks(
    prompt: string,
    options: GenerateOptions & { provider?: string; customProviders?: CustomProvider[] } = {}
  ): Promise<{ text: string; modelUsed: string }> {
    const def = resolveProviderDef(options.provider, options.customProviders || []);
    const effectiveKey = options.apiKey || envKeyFor(def);
    if (!effectiveKey && def.envKey) {
      throw new ProviderError(401, `${def.label}: API-ключ не налаштовано`);
    }

    const impl = getImpl(def);
    const candidates = [options.model, def.defaultModel, ...(def.freeModels || [])]
      .filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);

    let lastError: unknown = null;
    for (const model of candidates) {
      try {
        const text = await impl.generate(prompt, { ...options, model, apiKey: effectiveKey, jsonMode: true });
        return { text, modelUsed: model };
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        lastError = err;
        if (err instanceof ProviderError && (err.status === 401 || err.status === 404)) break;
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderError(500, 'All AI models failed');
  }
}

export const aiRouter = new AIRouter();
