import { BANKS, normalizeBank } from '@/lib/banks';
import { kyivDateString } from '@/lib/dates';

export interface FieldError {
  field: string;
  message: string;
}

export const CURRENCIES = ['UAH', 'USD', 'EUR', 'USDT'] as const;
export type SupportedCurrency = (typeof CURRENCIES)[number];

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function toFiniteNumber(v: unknown): number | null {
  if (isFiniteNumber(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Сума: число від 0 (або > 0), кінцеве, без NaN/Infinity. */
export function validateAmount(
  value: unknown,
  opts: { field?: string; label?: string; required?: boolean; min?: number; max?: number } = {},
): FieldError[] {
  const { field = 'amount', label = 'Сума', required = true, min = 0, max } = opts;
  if (value === '' || value === undefined || value === null) {
    return required ? [{ field, message: `${label}: вкажіть суму` }] : [];
  }
  const n = toFiniteNumber(value);
  if (n === null) return [{ field, message: `${label}: має бути числом` }];
  if (n < min) return [{ field, message: `${label}: не може бути меншою за ${min}` }];
  if (max !== undefined && n > max) return [{ field, message: `${label}: не може перевищувати ${max}` }];
  return [];
}

/** Відсоток: 0–100. За потреби — обов'язкове поле. */
export function validatePercent(
  value: unknown,
  field = 'percent',
  label = 'Відсоток',
  opts: { required?: boolean } = {},
): FieldError[] {
  if (value === '' || value === undefined || value === null) {
    return opts.required ? [{ field, message: `${label}: обов'язкове поле` }] : [];
  }
  const n = toFiniteNumber(value);
  if (n === null) return [{ field, message: `${label}: має бути числом` }];
  if (n < 0 || n > 100) return [{ field, message: `${label}: має бути від 0 до 100` }];
  return [];
}

/** Додатне число: обов'язкове, кінцеве, > 0 — без порожніх, NaN, Infinity і від'ємних. */
export function validatePositiveNumber(value: unknown, field: string, label: string): FieldError[] {
  if (value === '' || value === undefined || value === null) {
    return [{ field, message: `${label}: обов'язкове поле` }];
  }
  const n = toFiniteNumber(value);
  if (n === null) return [{ field, message: `${label}: має бути числом` }];
  if (n <= 0) return [{ field, message: `${label}: має бути більшим за 0` }];
  return [];
}

/** Курс валюти: > 0 і в межах розумного діапазону. */
export function validateRate(value: unknown, field = 'rate', label = 'Курс'): FieldError[] {
  const n = toFiniteNumber(value);
  if (n === null) return [{ field, message: `${label}: має бути числом` }];
  if (n <= 0) return [{ field, message: `${label}: має бути більшим за 0` }];
  if (n > 1_000_000) return [{ field, message: `${label}: нереально велике значення` }];
  return [];
}

/** Облікова дата (Europe/Kyiv): порожня або валідний календарний день. */
export function validateDate(value: unknown, opts: { field?: string; label?: string; required?: boolean } = {}): FieldError[] {
  const { field = 'date', label = 'Дата', required = false } = opts;
  if (value === undefined || value === null || String(value).trim() === '') {
    return required ? [{ field, message: `${label}: обов'язкова` }] : [];
  }
  const raw = String(value);
  const hasTime = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw);
  const normalized = kyivDateString(raw);
  if (!normalized) return [{ field, message: `${label}: некоректна дата` }];
  if (!hasTime && !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return [{ field, message: `${label}: некоректна дата` }];
  }
  return [];
}

export function validateRequiredText(value: unknown, field: string, label: string, maxLength = 200): FieldError[] {
  const s = typeof value === 'string' ? value.trim() : value === undefined || value === null ? '' : String(value);
  if (!s) return [{ field, message: `${label}: обов'язкове поле` }];
  if (s.length > maxLength) return [{ field, message: `${label}: не більше ${maxLength} символів` }];
  return [];
}

export function validateCurrency(value: unknown, field = 'currency', label = 'Валюта'): FieldError[] {
  const s = String(value || 'UAH');
  if (!(CURRENCIES as readonly string[]).includes(s)) {
    return [{ field, message: `${label}: недопустима валюта «${s}»` }];
  }
  return [];
}

/** Рахунок/гаманець має бути одним із відомих банків. */
export function validateBank(value: unknown, field = 'bank', label = 'Банк', required = true): FieldError[] {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return required ? [{ field, message: `${label}: оберіть рахунок` }] : [];
  const normalized = normalizeBank(s);
  if (BANKS.some(b => b.id === normalized)) return [];
  return [{ field, message: `${label}: невідомий рахунок «${s}»` }];
}

/** Вільна назва банку у проєкті: приймаємо відомі ID та власні назви. */
export function validateProjectBank(value: unknown, field = 'bank', label = 'Банк'): FieldError[] {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return [];
  if (s.length > 64) return [{ field, message: `${label}: не більше 64 символів` }];
  return [];
}

export function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  label: string,
): FieldError[] {
  if (value === undefined || value === null || value === '') {
    return [{ field, message: `${label}: оберіть значення` }];
  }
  if (!(allowed as readonly string[]).includes(String(value))) {
    return [{ field, message: `${label}: недопустиме значення «${String(value)}»` }];
  }
  return [];
}

export function validateTelegram(value: unknown, field = 'telegram'): FieldError[] {
  const s = typeof value === 'string' ? value.trim() : '';
  if (!s) return [];
  if (s.length > 64) return [{ field, message: 'Telegram: не більше 64 символів' }];
  return [];
}

export function formatErrors(errors: FieldError[]): string {
  return errors.map(e => e.message).join('; ');
}
