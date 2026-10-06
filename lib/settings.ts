import type { FinanceSettings } from '@/types';

// Кеш налаштувань фінансів у пам'яті: форматування та конвертації не повинні
// читати localStorage при кожному виклику. Кеш інвалідується після кожного
// збереження (див. saveFinanceSettings) та під час ініціалізації сховища.
export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  usdRate: 41,
  eurRate: 44,
  usdtRate: 41,
  displayCurrency: 'UAH',
};

const SETTINGS_STORAGE_KEY = 'crm_finance_settings';

let cached: FinanceSettings | null = null;
let cacheSource: 'memory' | 'storage' | 'default' = 'memory';

function isFinitePositive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function normalizeSettings(raw: unknown): FinanceSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<FinanceSettings>;
  const usdRate = isFinitePositive(input.usdRate, DEFAULT_FINANCE_SETTINGS.usdRate);
  return {
    usdRate,
    eurRate: isFinitePositive(input.eurRate, DEFAULT_FINANCE_SETTINGS.eurRate),
    usdtRate: isFinitePositive(input.usdtRate, usdRate),
    displayCurrency: input.displayCurrency === 'USD' || input.displayCurrency === 'EUR'
      ? input.displayCurrency
      : 'UAH',
  };
}

/** Встановити відомі налаштування (наприклад, після завантаження сховища). */
export function primeSettings(next: FinanceSettings | null | undefined): void {
  cached = next ? normalizeSettings(next) : null;
  cacheSource = next ? 'memory' : 'default';
}

/** Скинути кеш (тести / повторна ініціалізація). */
export function resetSettingsCache(): void {
  cached = null;
  cacheSource = 'default';
}

export function getSettings(): FinanceSettings {
  if (cached) return cached;
  if (typeof window === 'undefined') {
    cached = { ...DEFAULT_FINANCE_SETTINGS };
    cacheSource = 'default';
    return cached;
  }
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    cached = raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_FINANCE_SETTINGS };
    cacheSource = raw ? 'storage' : 'default';
  } catch {
    cached = { ...DEFAULT_FINANCE_SETTINGS };
    cacheSource = 'default';
  }
  return cached;
}

/** Динамічна валюта відображення (кешована). */
export function displayCurrencySetting(): 'UAH' | 'USD' | 'EUR' {
  return getSettings().displayCurrency || 'UAH';
}

export function rateFor(currency: string | undefined, settings: FinanceSettings = getSettings()): number {
  const cur = (currency || 'UAH').toUpperCase();
  if (cur === 'USD') return settings.usdRate;
  if (cur === 'EUR') return settings.eurRate;
  if (cur === 'USDT') return settings.usdtRate ?? settings.usdRate;
  return 1;
}

export function getCacheSource(): 'memory' | 'storage' | 'default' {
  return cacheSource;
}
