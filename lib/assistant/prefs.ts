import type { KeyCheckResult, ProviderId, ProviderKeyInput, ProviderSettings } from './contract';
import { DEFAULT_PROVIDER_SETTINGS, PROVIDERS, PROVIDER_MODELS } from './contract';
import { stripSecrets } from '@/lib/export';

// Налаштування провайдера/моделі зберігаються локально.
// API-ключі НЕ зберігаються ніде: ні в localStorage, ні в sessionStorage,
// ні в URL, ні в логах, ні в backup — до підключення захищеного
// серверного сховища (етап 2).
const STORAGE_KEY = 'crm_assistant_provider';

function normalize(value: unknown): ProviderSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<ProviderSettings>;
  const provider = (PROVIDERS as readonly string[]).includes(String(raw.provider))
    ? (raw.provider as ProviderId)
    : DEFAULT_PROVIDER_SETTINGS.provider;
  const models = PROVIDER_MODELS[provider].map(m => m.id);
  const model = raw.model && models.includes(raw.model) ? raw.model : models[0];
  return {
    provider,
    model,
    baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl.length < 300 ? raw.baseUrl : undefined,
    demo: raw.demo === true,
  };
}

export function loadProviderSettings(): ProviderSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_PROVIDER_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : { ...DEFAULT_PROVIDER_SETTINGS };
  } catch {
    return { ...DEFAULT_PROVIDER_SETTINGS };
  }
}

/**
 * Зберігає ТІЛЬКИ провайдер/модель/endpoint/demo.
 * Будь-які поля, схожі на секрети, відсіюються перед записом.
 */
export function saveProviderSettings(settings: ProviderSettings): ProviderSettings {
  const safe = normalize(stripSecrets(settings));
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    } catch {
      // Немає місця — налаштування лишаться до кінця сесії.
    }
  }
  return safe;
}

const KEY_PATTERNS: Record<ProviderId, RegExp> = {
  openai: /^sk-[A-Za-z0-9_\-]{8,}$/,
  anthropic: /^sk-ant-[A-Za-z0-9_\-]{8,}$/,
  google: /^AIza[A-Za-z0-9_\-]{10,}$/,
  custom: /^[A-Za-z0-9_\-\.]{12,}$/,
};

/**
 * ЛОКАЛЬНА перевірка формату ключа. Виконується з фіктивним значенням
 * у UI; результат нікуди не передається і не зберігається
 * (`persisted` завжди false).
 */
export function checkKeyFormat(input: ProviderKeyInput): KeyCheckResult {
  const key = (input.key || '').trim();
  if (!key) {
    return { ok: false, message: 'Введіть ключ для перевірки формату', persisted: false };
  }
  if (/\s/.test(key)) {
    return { ok: false, message: 'Ключ містить пробіли — перевірте значення', persisted: false };
  }
  if (key.length < 12) {
    return { ok: false, message: 'Ключ закороткий для цього провайдера', persisted: false };
  }
  const pattern = KEY_PATTERNS[input.provider];
  if (pattern && !pattern.test(key)) {
    return {
      ok: false,
      message: `Формат ключа не відповідає провайдеру ${input.provider}`,
      persisted: false,
    };
  }
  return {
    ok: true,
    message: 'Формат ключа виглядає коректним (перевірка локальна; ключ не збережено і не надсилався)',
    persisted: false,
  };
}

/** Забезпечує, що в сховищі немає ключів (викликається при старті). */
export function assertNoStoredSecrets(): string[] {
  if (typeof window === 'undefined') return [];
  const found: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (/(api[_-]?key|secret|token|password|credential)/i.test(key)) found.push(key);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && /(api[_-]?key|secret|token|password|credential)/i.test(raw)) found.push(STORAGE_KEY);
  } catch {
    return found;
  }
  return found;
}
