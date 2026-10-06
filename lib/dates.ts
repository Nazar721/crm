// Облікова дата CRM. Усі «сьогодні», місячні ключі та форматування дат
// рахуються у часовому поясі Europe/Kyiv, незалежно від часового поясу пристрою.
export const ACCOUNTING_TIME_ZONE = 'Europe/Kyiv';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})/;

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = dateFormatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: ACCOUNTING_TIME_ZONE, ...options });
    dateFormatters.set(key, f);
  }
  return f;
}

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Перетворює вхідне значення на календарну дату YYYY-MM-DD у Europe/Kyiv.
 * - рядок вигляду YYYY-MM-DD вважається вже обліковою датою (без годинникової похибки);
 * - повний ISO-момент конвертується у часовий пояс Kyiv;
 * - Date/число трактуються як момент часу.
 * Повертає null для порожніх/некоректних значень.
 */
export function kyivDateString(input?: string | number | Date | null): string | null {
  if (input === undefined || input === null || input === '') return null;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    if (DATE_ONLY_RE.test(trimmed)) return isValidDateOnly(trimmed) ? trimmed : null;
    const prefix = ISO_PREFIX_RE.exec(trimmed)?.[1];
    const parsed = new Date(trimmed);
    if (isNaN(parsed.getTime())) {
      return prefix && isValidDateOnly(prefix) ? prefix : null;
    }
    return formatInstant(parsed);
  }

  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;
  return formatInstant(d);
}

function formatInstant(d: Date): string | null {
  const parts = formatter({ year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  if (!y || !m || !day) return null;
  const result = `${y}-${m}-${day}`;
  return isValidDateOnly(result) ? result : null;
}

/** «Сьогодні» за обліковим поясом (YYYY-MM-DD). */
export function todayKyiv(now: Date = new Date()): string {
  return formatInstant(now) || `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/** Місячний ключ YYYY-MM-DD → YYYY-MM. Облікова дата за Europe/Kyiv. */
export function monthKeyOf(input?: string | number | Date | null): string | null {
  const date = kyivDateString(input);
  return date ? date.slice(0, 7) : null;
}

/** Кількість календарних днів між обліковими датами (за Europe/Kyiv). */
export function calendarDaysBetween(start?: string, end?: string): number | null {
  const a = kyivDateString(start);
  const b = kyivDateString(end);
  if (!a || !b) return null;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86400000);
}

/** Форматування облікової дати для відображення. */
export function formatKyivDate(input?: string | null, locale: string = 'uk-UA'): string {
  const date = kyivDateString(input);
  if (!date) return '—';
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

/** Форматування моменту часу (з годинами) за Europe/Kyiv. */
export function formatKyivDateTime(input?: string | null, locale: string = 'uk-UA'): string {
  if (!input) return '—';
  const d = new Date(input);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    timeZone: ACCOUNTING_TIME_ZONE,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}
