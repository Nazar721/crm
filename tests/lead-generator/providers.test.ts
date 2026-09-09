import { describe, it, expect } from 'vitest';
import { PROVIDERS, PROVIDER_LIST, DEFAULT_PROVIDERS, customProviderToDef } from '../../lib/lead-generator/ai/providers';
import { resolveProviderDef } from '../../lib/lead-generator/ai/AIRouter';
import { PROVIDER_IDS, ProviderId, CustomProvider } from '../../lib/lead-generator/types';
import { MultiProvider } from '../../lib/lead-generator/ai/MultiProvider';

describe('provider registry', () => {
  it('has a definition for every provider id', () => {
    for (const id of PROVIDER_IDS) {
      expect(PROVIDERS[id]).toBeDefined();
      expect(PROVIDERS[id].label).toBeTruthy();
      expect(PROVIDERS[id].baseUrl).toMatch(/^https:\/\//);
      expect(PROVIDERS[id].envKey).toBeTruthy();
    }
    expect(PROVIDER_LIST).toHaveLength(PROVIDER_IDS.length);
  });

  it('every provider has a default model', () => {
    for (const id of PROVIDER_IDS) {
      expect(DEFAULT_PROVIDERS[id]).toBeTruthy();
    }
  });

  it('resolveProviderDef falls back to openrouter for unknown values', () => {
    expect(resolveProviderDef('unknown-thing').id).toBe('openrouter');
    expect(resolveProviderDef(undefined).id).toBe('openrouter');
    expect(resolveProviderDef('anthropic').id).toBe('anthropic');
  });

  it('resolveProviderDef resolves custom providers by setting id', () => {
    const cp: CustomProvider = { id: 'abc123', label: 'My Proxy', baseUrl: 'https://proxy.example.com/v1', apiKey: 'k', defaultModel: 'model-x' };
    const def = resolveProviderDef('custom-abc123', [cp]);
    expect(def.id).toBe('custom-abc123');
    expect(def.label).toBe('My Proxy');
    expect(def.baseUrl).toBe('https://proxy.example.com/v1');
    expect(def.defaultModel).toBe('model-x');
    // falls back to openrouter when custom provider not found
    expect(resolveProviderDef('custom-missing', [cp]).id).toBe('openrouter');
  });

  it('anthropic uses its own chat style; the rest are openai-compatible', () => {
    expect(PROVIDERS.anthropic.chatStyle).toBe('anthropic');
    for (const id of PROVIDER_IDS.filter((p) => p !== 'anthropic')) {
      expect(PROVIDERS[id].chatStyle).toBe('openai');
    }
  });
});

describe('MultiProvider availability', () => {
  it('isAvailable reflects key presence, not network', async () => {
    const impl = new MultiProvider(PROVIDERS.openai);
    expect(await impl.isAvailable('sk-test')).toBe(true);
    const originalEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(await impl.isAvailable('')).toBe(false);
    } finally {
      if (originalEnv !== undefined) process.env.OPENAI_API_KEY = originalEnv;
    }
  });

  it('generate without key throws 401 immediately', async () => {
    const impl = new MultiProvider(PROVIDERS.openai);
    const originalEnv = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(impl.generate('test', { model: 'gpt-4o-mini', apiKey: '' })).rejects.toMatchObject({ status: 401 });
    } finally {
      if (originalEnv !== undefined) process.env.OPENAI_API_KEY = originalEnv;
    }
  });

  it('custom provider definition works keyless (local servers)', async () => {
    const def = customProviderToDef({ id: 'local1', label: 'Ollama Local', baseUrl: 'http://localhost:11434/v1', apiKey: '', defaultModel: 'llama3.1' });
    const impl = new MultiProvider(def);
    expect(await impl.isAvailable('')).toBe(true);
    expect(def.baseUrl).toBe('http://localhost:11434/v1');
    expect(def.chatStyle).toBe('openai');
  });
});
