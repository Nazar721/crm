// ============================================================
// Реєстр вкладок «Налаштування» (пакет 01).
// Жодних нових колекцій чи міграцій: лише поділ чинного вмісту
// сторінки /settings на вкладки. Реєстр централізований, щоб
// пакети 04 (хостинг) і 05 (завдання/нагадування) додавали свої
// вкладки в одному місці без паралельних правок сторінки.
// ============================================================

export const SETTINGS_TABS = [
  { id: 'finance', label: 'Фінанси', hint: 'Валюта відображення та курси' },
  { id: 'assistant', label: 'AI-помічник', hint: 'Провайдер, модель, demo-режим' },
  { id: 'backup', label: 'Копії та імпорт', hint: 'Експорт, імпорт, відновлення' },
  { id: 'history', label: 'Історія змін', hint: 'Журнал змін і скасування' },
  { id: 'reminders', label: 'Нагадування', hint: 'Сповіщення в CRM і їх стан' },
  { id: 'system', label: 'Система', hint: 'Збереження, стан, журнал' },
] as const;

export type SettingsTabId = (typeof SETTINGS_TABS)[number]['id'];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = 'finance';

/** Невідома/порожня вкладка (старий ключ, описка в sessionStorage) → базова. */
export function normalizeSettingsTabId(value: unknown): SettingsTabId {
  if (typeof value === 'string') {
    const found = SETTINGS_TABS.find(t => t.id === value);
    if (found) return found.id;
  }
  return DEFAULT_SETTINGS_TAB;
}

export function isSettingsTabId(value: unknown): value is SettingsTabId {
  return typeof value === 'string' && SETTINGS_TABS.some(t => t.id === value);
}

export function getSettingsTab(id: SettingsTabId): (typeof SETTINGS_TABS)[number] {
  return SETTINGS_TABS.find(t => t.id === id) ?? SETTINGS_TABS[0];
}

// ------------------------------------------------------------
// URL-навігація (P2): валідний `?tab=` має пріоритет над
// sessionStorage; невідомий нормалізується до базової.
// Чисті функції — покриті тестами без браузера.
// ------------------------------------------------------------

/** Витягти вкладку з query (`?tab=backup`). `null` — параметра немає або він невалідний. */
export function parseSettingsTabFromSearch(search: string | null | undefined): SettingsTabId | null {
  if (!search || typeof search !== 'string') return null;
  const query = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(query);
  const raw = params.get('tab');
  if (!raw) return null;
  const found = SETTINGS_TABS.find(t => t.id === raw);
  return found ? found.id : null;
}

/**
 * Розв'язати активну вкладку: query (URL) → збережена (sessionStorage) → базова.
 * Відсутність параметра і некоректний параметр РОЗРІЗНЯЮТЬСЯ:
 * - параметра `tab` немає → fallback на збережену/базову;
 * - параметр Є, але невідомий або порожній → нормалізація до базової `finance`.
 */
export function resolveSettingsTab(input: { search?: string | null; stored?: unknown }): SettingsTabId {
  const search = input.search ?? null;
  if (typeof search === 'string' && search.length > 0) {
    let has = false;
    let raw: string | null = null;
    try {
      const query = search.startsWith('?') ? search.slice(1) : search;
      const params = new URLSearchParams(query);
      has = params.has('tab');
      raw = params.get('tab');
    } catch {
      has = false;
      raw = null;
    }
    if (has) {
      const found = typeof raw === 'string' ? SETTINGS_TABS.find(t => t.id === raw) : undefined;
      return found ? found.id : DEFAULT_SETTINGS_TAB;
    }
  }
  return normalizeSettingsTabId(input.stored);
}

/**
 * Реактивна версія для сторінки: приймає вже прочитані `has`/`raw`
 * з Next `useSearchParams` (той самий контракт, що й resolveSettingsTab).
 * Семантика ідентична: missing → stored, invalid/empty → finance.
 */
export function resolveSettingsTabParam(
  has: boolean,
  raw: string | null | undefined,
  stored: unknown,
): SettingsTabId {
  if (has) {
    const found = typeof raw === 'string' ? SETTINGS_TABS.find(t => t.id === raw) : undefined;
    return found ? found.id : DEFAULT_SETTINGS_TAB;
  }
  return normalizeSettingsTabId(stored);
}

/** Канонічне посилання на вкладку (для банерів і оновлення URL). */
export function settingsTabHref(tab: SettingsTabId): string {
  return `/settings?tab=${normalizeSettingsTabId(tab)}`;
}

// ------------------------------------------------------------
// Чернетки (P1/P2): чисті помічники життєвого циклу форм.
// ------------------------------------------------------------

export interface RatesDraft {
  usdRate: string;
  eurRate: string;
  usdtRate: string;
}

export interface RatesDirty {
  usd: boolean;
  eur: boolean;
  usdt: boolean;
}

export const CLEAN_RATES_DIRTY: RatesDirty = { usd: false, eur: false, usdt: false };

/**
 * Синхронізувати чернетку курсів зі snapshot, НЕ затираючи поля,
 * які користувач уже редагує (dirty). Чисті поля підтягують актуальні
 * значення (напр. після зміни displayCurrency поруч), брудні лишаються.
 */
export function syncRatesDraft(
  draft: RatesDraft,
  snapshot: { usdRate: unknown; eurRate: unknown; usdtRate?: unknown },
  dirty: RatesDirty,
): RatesDraft {
  const fallbackUsd = String(snapshot.usdRate ?? '');
  return {
    usdRate: dirty.usd ? draft.usdRate : String(snapshot.usdRate ?? ''),
    eurRate: dirty.eur ? draft.eurRate : String(snapshot.eurRate ?? ''),
    usdtRate: dirty.usdt ? draft.usdtRate : String(snapshot.usdtRate ?? fallbackUsd),
  };
}

/** Чи збігається чернетка курсів зі snapshot (чи є незбережені зміни). */
export function isRatesDraftDirty(
  draft: RatesDraft,
  snapshot: { usdRate: unknown; eurRate: unknown; usdtRate?: unknown },
): boolean {
  const clean = syncRatesDraft(draft, snapshot, CLEAN_RATES_DIRTY);
  return draft.usdRate !== clean.usdRate || draft.eurRate !== clean.eurRate || draft.usdtRate !== clean.usdtRate;
}
