import {
  calendarDaysBetween,
  formatKyivDate,
  formatKyivDateTime,
  monthKeyOf,
  todayKyiv,
} from '@/lib/dates';
import { displayCurrencySetting } from '@/lib/settings';

export type Currency = 'UAH' | 'USD' | 'EUR' | 'USDT';

export const CURRENCY_SYMBOLS: Record<string, string> = { UAH: '₴', USD: '$', EUR: '€', USDT: 'USDT' };

export function currencySymbol(cur?: string): string {
  return CURRENCY_SYMBOLS[cur || 'UAH'] || '₴';
}

/** Динамічна валюта відображення (кеш у пам'яті, без читання localStorage на кожен виклик). */
export function displayCurrency(): Currency {
  return displayCurrencySetting();
}

export function itemCurrency(item?: { currency?: string } | null): string {
  return item?.currency || 'UAH';
}

export function formatMoney(n: number, currency?: string): string {
  const num = Number(n) || 0;
  const cur = currency || displayCurrency();
  const sym = currencySymbol(cur);
  const dec = cur === 'UAH' ? 0 : 2;
  const s = num.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: dec });
  return cur === 'USDT' ? `${s} USDT` : sym + s;
}

export function formatDate(str?: string): string {
  return formatKyivDate(str);
}

export function formatDateTime(str?: string): string {
  return formatKyivDateTime(str);
}

/** Облікова дата «сьогодні» (Europe/Kyiv), YYYY-MM-DD. */
export function today(): string {
  return todayKyiv();
}

export function daysBetween(start: string, end: string): number {
  return calendarDaysBetween(start, end) ?? 0;
}

export function escHtml(str?: string): string {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Місячний ключ дати за обліковим поясом Europe/Kyiv. */
export function getMonthKey(dateStr?: string): string | null {
  return monthKeyOf(dateStr);
}

export function getMonthLabel(key?: string): string {
  if (!key) return '';
  const [y, m] = key.split('-');
  const months = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

export function debounce<T extends (...args: unknown[]) => void>(fn: T, wait: number): T {
  let t: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  }) as T;
}
