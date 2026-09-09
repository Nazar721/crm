import { AIProvider, GenerateOptions, ProviderModel, ProviderDefinition } from './providers';
import { ProviderError } from './ProviderError';

const TIMEOUT_MS = 60000;
const MAX_RETRIES = 2;

type ChatStyle = ProviderDefinition['chatStyle'];

function chatRequest(def: ProviderDefinition, prompt: string, options: GenerateOptions) {
  const model = options.model || '';
  const apiKey = options.apiKey!;

  if (def.chatStyle === 'anthropic') {
    return {
      url: `${def.baseUrl}/messages`,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: {
        model,
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }],
      },
    };
  }

  // OpenAI-compatible (openrouter, openai, gemini-openai-compat, groq, mistral, custom)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (def.id === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost:3000';
    headers['X-Title'] = 'WebCRM Lead Generator';
  }

  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1024,
  };
  if (options.jsonMode && def.chatStyle === 'openai') {
    body.response_format = { type: 'json_object' };
  }

  return { url: `${def.baseUrl}/chat/completions`, headers, body };
}

function extractText(chatStyle: ChatStyle, data: Record<string, unknown>): string {
  if (chatStyle === 'anthropic') {
    const content = data.content as Array<{ type: string; text?: string }> | undefined;
    return content?.map((c) => c.text || '').join('') || '';
  }
  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
  return choices?.[0]?.message?.content || '';
}

export class MultiProvider implements AIProvider {
  private def: ProviderDefinition;

  constructor(def: ProviderDefinition) {
    this.def = def;
  }

  getName(): string {
    return this.def.label;
  }

  async isAvailable(apiKey?: string): Promise<boolean> {
    if (this.def.envKey) {
      const key = apiKey || process.env[this.def.envKey] || '';
      return Boolean(key);
    }
    // custom providers: key optional (local servers like Ollama work keyless)
    return Boolean(apiKey || this.def.baseUrl);
  }

  async listModels(apiKey: string, signal?: AbortSignal): Promise<ProviderModel[]> {
    const timeoutSignal = AbortSignal.timeout(15000);
    const headers: Record<string, string> = {};
    if (apiKey) {
      if (this.def.chatStyle === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.Authorization = `Bearer ${apiKey}`;
      }
    }
    const res = await fetch(`${this.def.baseUrl}${this.def.modelsPath}`, {
      headers,
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
    if (!res.ok) {
      throw new ProviderError(res.status, `Models list error ${res.status}`);
    }
    const data = await res.json();
    return this.parseModels(data);
  }

  private parseModels(data: Record<string, unknown>): ProviderModel[] {
    const list =
      (data.data as Array<Record<string, unknown>> | undefined) ??
      (data.models as Array<Record<string, unknown>> | undefined) ??
      [];
    return list
      .map((m) => {
        const rawId = String(m.id ?? m.name ?? '');
        // Ollama-style entries carry "name" without base path; strip version suffix "@..."-style noise
        const id = rawId.replace(/^models\//, '');
        return { id, label: (m.name as string | undefined) || undefined };
      })
      .filter((m) => m.id && !m.id.includes('embedding') && !m.id.includes('whisper') && !m.id.includes('tts') && !m.id.includes('image') && !m.id.includes('moderation'))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const apiKey = options.apiKey || (this.def.envKey ? process.env[this.def.envKey] || '' : '');
    const model = options.model;
    if (!apiKey && this.def.envKey) throw new ProviderError(401, `${this.getName()} API key not configured`);
    if (!model) throw new ProviderError(400, 'Model is not specified');

    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (attempt > 0) {
        const delay = Math.min(8000, 1000 * 2 ** (attempt - 1));
        await this.sleep(delay, options.signal);
      }
      try {
        const req = chatRequest(this.def, prompt, { ...options, model, apiKey });
        const timeoutSignal = AbortSignal.timeout(TIMEOUT_MS);
        const res = await fetch(req.url, {
          method: 'POST',
          headers: req.headers,
          body: JSON.stringify(req.body),
          signal: options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new ProviderError(res.status, `${this.getName()} API error ${res.status}: ${errText.slice(0, 300)}`);
        }

        const data = await res.json();
        return extractText(this.def.chatStyle, data);
      } catch (err) {
        lastError = err;
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        if (err instanceof ProviderError && (err.status === 401 || err.status === 404)) throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new ProviderError(500, 'Provider request failed');
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    });
  }
}
