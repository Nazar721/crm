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
