import { ProviderId } from '../types';

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
  id: ProviderId;
  label: string;
  keyHint: string;
  baseUrl: string;
  modelsPath: string;
  /** OpenAI-compatible /chat/completions */
  chatStyle: 'openai' | 'anthropic' | 'gemini';
  /** env var checked as fallback when no key stored in DB */
  envKey: string;
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
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    keyHint: 'sk-ant-…',
    baseUrl: 'https://api.anthropic.com/v1',
    modelsPath: '/models',
    chatStyle: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    keyHint: 'AIza…',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    modelsPath: '/models',
    chatStyle: 'openai',
    envKey: 'GEMINI_API_KEY',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    keyHint: 'gsk_…',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelsPath: '/models',
    chatStyle: 'openai',
    envKey: 'GROQ_API_KEY',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    keyHint: '…',
    baseUrl: 'https://api.mistral.ai/v1',
    modelsPath: '/models',
    chatStyle: 'openai',
    envKey: 'MISTRAL_API_KEY',
  },
};

export const PROVIDER_LIST: ProviderDefinition[] = Object.values(PROVIDERS);

export const DEFAULT_PROVIDERS: Record<ProviderId, string> = {
  openrouter: 'meta-llama/llama-4-maverick:free',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-small-latest',
} as const;
