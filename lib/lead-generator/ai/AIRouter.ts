import { ProviderId } from '../types';
import { AIProvider, GenerateOptions, ProviderDefinition, PROVIDERS, DEFAULT_PROVIDERS } from './providers';
import { MultiProvider, ProviderError } from './MultiProvider';

const implCache = new Map<ProviderId, AIProvider>();

function getImpl(providerId: ProviderId): AIProvider {
  let impl = implCache.get(providerId);
  if (!impl) {
    impl = new MultiProvider(providerId);
    implCache.set(providerId, impl);
  }
  return impl;
}

export function resolveProviderDef(provider: string | undefined): ProviderDefinition {
  if (provider && provider in PROVIDERS) return PROVIDERS[provider as ProviderId];
  return PROVIDERS.openrouter;
}

export function envKeyFor(def: ProviderDefinition): string {
  return process.env[def.envKey] || '';
}

export class AIRouter {
  async isAvailable(provider: string, apiKey?: string): Promise<boolean> {
    const def = resolveProviderDef(provider);
    return Boolean(apiKey || envKeyFor(def));
  }

  async generateWithFallbacks(
    prompt: string,
    options: GenerateOptions & { provider?: string } = {}
  ): Promise<{ text: string; modelUsed: string }> {
    const def = resolveProviderDef(options.provider);
    const apiKey = options.apiKey || envKeyFor(def);
    if (!apiKey) throw new ProviderError(401, `${def.label}: API-ключ не налаштовано`);

    const impl = getImpl(def.id);
    // Fallback candidates: chosen model first, then provider default, then free models (openrouter only)
    const candidates = [options.model, DEFAULT_PROVIDERS[def.id], ...(def.freeModels || [])]
      .filter((m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i);

    let lastError: unknown = null;
    for (const model of candidates) {
      try {
        const text = await impl.generate(prompt, { ...options, model, apiKey, jsonMode: true });
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
