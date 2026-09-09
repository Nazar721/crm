import { ProviderId, CustomProvider, customProviderSettingId } from '../types';

export interface GenerateOptions {
  model?: string;
  apiKey?: string;
  signal?: AbortSignal;
  jsonMode?: boolean;
}

export interface ProviderModel {
  id: string;
  label?: string;
}

export interface AIProvider {
  getName(): string;
  isAvailable(apiKey?: string): Promise<boolean>;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  listModels(apiKey: string, signal?: AbortSignal): Promise<ProviderModel[]>;
}

export interface ProviderDefinition {
  /** stable id: built-in ProviderId or `custom-<id>` */
  id: string;
  label: string;
  keyHint: string;
  baseUrl: string;
  modelsPath: string;
  /** OpenAI-compatible /chat/completions */
  chatStyle: 'openai' | 'anthropic' | 'gemini';
  /** env var checked as fallback when no key stored in DB (built-ins only) */
  envKey: string;
  defaultModel: string;
  /** free models usable without a key (only openrouter has these) */
  freeModels?: string[];
}
export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    keyHint: 'sk-or-v1-…',
    baseUrl: 'https://openrouter.ai/api/v1',
    modelsPath: '/models',
    chatStyle: 'openai',
    envKey: 'OPENROUTER_API_KEY',
    defaultModel: 'meta-llama/llama-4-maverick:free',
    freeModels: ['meta-llama/llama-4-maverick:free', 'google/gemini-2.0-flash-001:free', 'openai/gpt-4o-mini:free'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keyHint: 'sk-…',
    baseUrl: 'https://api.openai.com/v1',
    modelsPath: '/models',
    chatStyle: 'openai',
    envKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keyHint: 'sk-ant-…',
    baseUrl: 'https://api.anthropic.com/v1',
    modelsPath: '/models',
    chatStyle: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-3-5-haiku-latest',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    keyHint: 'AIza…',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelsPath: '/models',
    chatStyle: 'openai',
    envKey: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.0-flash',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    keyHint: 'gsk_…',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsPath: '/models',
    chatStyle: 'openai',
    envKey: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    keyHint: '…',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsPath: '/models',
    chatStyle: 'openai',
    envKey: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-small-latest',
  },
};

export const PROVIDER_LIST: ProviderDefinition[] = Object.values(PROVIDERS);

export const DEFAULT_PROVIDERS: Record<ProviderId, string> = Object.fromEntries(
  Object.entries(PROVIDERS).map(([id, def]) => [id, def.defaultModel])
) as Record<ProviderId, string>;

/** Convert a stored custom provider into a runtime provider definition (OpenAI-compatible). */
export function customProviderToDef(cp: CustomProvider): ProviderDefinition {
  const base = cp.baseUrl.replace(/\/+$/, '');
  return {
    id: customProviderSettingId(cp.id),
    label: cp.label || 'Custom',
    keyHint: 'optional',
    baseUrl: base,
    modelsPath: '/models',
    chatStyle: 'openai',
    envKey: '',
    defaultModel: cp.defaultModel || '',
  };
}
