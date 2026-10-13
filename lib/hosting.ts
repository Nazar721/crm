import type { HostingPayment, HostingService } from '@/types';
import { daysBetween, today } from '@/lib/utils';
import { validateAmount, validateDate, validateRequiredText, toFiniteNumber } from '@/lib/validate';

// ============================================================
// Пакет 04: спільні розрахунки хостингу (UI + AI-помічник).
// Дати — календарні дні Europe/Kyiv (YYYY-MM-DD, лексикографічне
// порівняння). День завершення періоду включно оплачений;
// прострочення — з наступного дня. Майбутній оплачений період НЕ
// робить послугу оплаченою сьогодні: прогалини враховуються.
// Запис оплати — лише облік факту; він не є підтвердженням продовження
// у провайдері і не створює транзакцій «Фінансів».
// ============================================================

export type HostingStatus = 'no_payment' | 'paid' | 'ending' | 'overdue' | 'archived';

export const HOSTING_STATUS_LABELS: Record<HostingStatus, string> = {
  no_payment: 'Без оплати',
  paid: 'Оплачено',
  ending: 'Закінчується',
  overdue: 'Прострочено',
  archived: 'Архів',
};

export interface HostingPeriod {
  start: string;
  end: string;
}

export interface HostingCoverage {
  status: HostingStatus;
  /** День завершення покриття на «сьогодні»; null — покриття на сьогодні немає. */
  coverageEnd: string | null;
  /** Днів до завершення (0 = сьогодні останній оплачений день). */
  daysLeft: number | null;
  /** Наступний майбутній оплачений період (починається пізніше за «сьогодні»). */
  nextPeriod: HostingPeriod | null;
  /** Прогалина: на сьогодні не оплачено, але майбутні періоди є. */
  hasGap: boolean;
  /** Короткі попередження для UI/помічника (30/7/1 день, сьогодні, прострочення). */
  warnings: string[];
  /** Остання оплата за ДАТОЮ оплати (не за порядком записів). */
  lastPayment: HostingPayment | null;
}

/** Валідний оплачений період: обидві дати YYYY-MM-DD, початок не пізніший за кінець. */
function toPeriod(payment: HostingPayment): HostingPeriod | null {
  const start = typeof payment.periodStart === 'string' ? payment.periodStart : '';
  const end = typeof payment.periodEnd === 'string' ? payment.periodEnd : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  if (start > end) return null;
  return { start, end };
}

/** Покриття на день: існує період із start ≤ day ≤ end (день кінця включно). */
export function coverageOn(periods: HostingPeriod[], day: string): HostingPeriod | null {
  let best: HostingPeriod | null = null;
  for (const period of periods) {
    if (period.start <= day && day <= period.end) {
      if (!best || period.end > best.end) best = period;
    }
  }
  return best;
}

/** Остання оплата за датою оплати; порядок записів не має значення. */
export function lastPaymentOf(payments: HostingPayment[]): HostingPayment | null {
  let best: HostingPayment | null = null;
  for (const payment of payments) {
    const date = typeof payment.date === 'string' ? payment.date : '';
    const bestDate = best && typeof best.date === 'string' ? best.date : '';
    if (!best || date > bestDate || (date === bestDate && String(payment.id) > String(best.id))) {
      best = payment;
    }
  }
  return best;
}

export function paymentsOfService(serviceId: string, payments: HostingPayment[]): HostingPayment[] {
  return payments
    .filter(p => p.serviceId === serviceId)
    .slice()
    .sort((a, b) => (a.date === b.date ? String(a.id).localeCompare(String(b.id)) : String(a.date).localeCompare(String(b.date))));
}

/** Стан покриття картки на заданий день. */
export function hostingCoverage(
  service: HostingService,
  payments: HostingPayment[],
  day: string = today(),
): HostingCoverage {
  const own = paymentsOfService(service.id, payments);
  const periods: HostingPeriod[] = [];
  for (const payment of own) {
    const period = toPeriod(payment);
    if (period) periods.push(period);
  }
  const last = lastPaymentOf(own);
  const covered = coverageOn(periods, day);
  const future = periods
    .filter(p => p.start > day)
    .sort((a, b) => a.start.localeCompare(b.start));
  const nextPeriod = future.length ? { start: future[0].start, end: future[0].end } : null;

  const coverageEnd = covered ? covered.end : null;
  const daysLeft = covered ? Math.max(0, daysBetween(day, covered.end)) : null;
  const hasGap = !covered && nextPeriod !== null;

  let status: HostingStatus;
  if (service.archived) status = 'archived';
  else if (!own.length) status = 'no_payment';
  else if (covered) status = daysLeft !== null && daysLeft <= 30 ? 'ending' : 'paid';
  else status = 'overdue';

  const warnings: string[] = [];
  if (!service.archived) {
    if (covered && daysLeft !== null && daysLeft <= 30) {
      if (daysLeft === 0) warnings.push('Закінчується сьогодні (останній оплачений день)');
      else warnings.push(`Закінчується через ${daysLeft} дн.`);
    }
    if (!covered && own.length) {
      warnings.push(hasGap
        ? `Прогалина: на сьогодні покриття немає; наступний оплачений період із ${nextPeriod!.start}`
        : 'Прострочено: оплачене покриття завершилося');
    }
  }

  return { status, coverageEnd, daysLeft, nextPeriod, hasGap, warnings, lastPayment: last };
}

/**
 * Календарне додавання місяців із пригортанням дня до кінця місяця:
 * 31.01 + 1м → 28.02/29.02 (високосний); 29.02.2024 + 12м → 28.02.2025.
 */
export function addCalendarMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const total = (y * 12 + (m - 1)) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12 + 12) % 12 + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addCalendarDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Пропозиція продовження «на N місяців» (лише пропозиція для чернетки):
 * початок — наступний день після безперервного поточного покриття.
 * Для прострочення/прогалини початок не визначений — власник уточнює.
 */
export function proposeExtension(
  service: HostingService,
  payments: HostingPayment[],
  months: number,
  day: string = today(),
): { start: string; end: string } | null {
  const coverage = hostingCoverage(service, payments, day);
  if (!coverage.coverageEnd) return null; // без оплати або прострочення/прогалина
  const start = addCalendarDays(coverage.coverageEnd, 1);
  // Кінець періоду ВКЛЮЧНО: «ще на рік» від 12.10.2027 → 11.10.2028
  // (приклад ТЗ: 12.10.2026–11.10.2027).
  const end = addCalendarDays(addCalendarMonths(start, months), -1);
  return { start, end };
}

/** Фактичні витрати за датою оплати; суми різних валют НЕ змішуються. */
export function hostingTotalsByCurrency(
  payments: HostingPayment[],
  range?: { from?: string; to?: string },
): { currency: string; total: number; count: number }[] {
  const byCurrency = new Map<string, { total: number; count: number }>();
  for (const payment of payments) {
    const date = typeof payment.date === 'string' ? payment.date : '';
    if (range?.from && date < range.from) continue;
    if (range?.to && date > range.to) continue;
    const currency = payment.currency || 'UAH';
    const amount = toFiniteNumber(payment.amount) ?? 0;
    const entry = byCurrency.get(currency) ?? { total: 0, count: 0 };
    entry.total += amount;
    entry.count += 1;
    byCurrency.set(currency, entry);
  }
  return [...byCurrency.entries()]
    .map(([currency, entry]) => ({ currency, total: entry.total, count: entry.count }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export interface HostingSummary {
  active: number;
  noPayment: number;
  endingWithin30: number;
  overdue: number;
  archived: number;
  totals: { currency: string; total: number; count: number }[];
}

export function hostingSummary(
  services: HostingService[],
  payments: HostingPayment[],
  day: string = today(),
): HostingSummary {
  let active = 0;
  let noPayment = 0;
  let endingWithin30 = 0;
  let overdue = 0;
  let archived = 0;
  for (const service of services) {
    const coverage = hostingCoverage(service, payments, day);
    if (coverage.status === 'archived') { archived += 1; continue; }
    active += 1;
    if (coverage.status === 'no_payment') noPayment += 1;
    else if (coverage.status === 'overdue') overdue += 1;
    else if (coverage.status === 'ending') endingWithin30 += 1;
  }
  return { active, noPayment, endingWithin30, overdue, archived, totals: hostingTotalsByCurrency(payments) };
}

/** Пошук/фільтри сторінки (назва, домен, провайдер; стан, провайдер). */
export function filterHostingServices(
  services: HostingService[],
  payments: HostingPayment[],
  filters: { query?: string; status?: HostingStatus | ''; provider?: string; day?: string },
): { service: HostingService; coverage: HostingCoverage }[] {
  const day = filters.day ?? today();
  const query = (filters.query ?? '').trim().toLowerCase();
  const provider = (filters.provider ?? '').trim().toLowerCase();
  return services
    .map(service => ({ service, coverage: hostingCoverage(service, payments, day) }))
    .filter(({ service, coverage }) => {
      if (filters.status && coverage.status !== filters.status) return false;
      if (provider && !(service.provider || '').toLowerCase().includes(provider)) return false;
      if (query) {
        const haystack = [service.name, service.site, service.provider]
          .map(v => String(v || '').toLowerCase());
        if (!haystack.some(v => v.includes(query))) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.service.archived !== b.service.archived) return a.service.archived ? 1 : -1;
      return a.service.name.localeCompare(b.service.name);
    });
}

// ------------------------------------------------------------
// Валідація (спільна для форми, дій і AI).
// ------------------------------------------------------------

export const HOSTING_CURRENCIES = ['UAH', 'USD', 'EUR'] as const;

export function validateHostingServiceInput(input: Partial<HostingService>): { field: string; message: string }[] {
  const errors = validateRequiredText(input.name, 'name', 'Назва послуги', 200);
  if (input.currency !== undefined && input.currency !== '' && !(HOSTING_CURRENCIES as readonly string[]).includes(String(input.currency))) {
    errors.push({ field: 'currency', message: 'Валюта: UAH, USD або EUR' });
  }
  if (input.expectedPrice !== undefined && input.expectedPrice !== null && input.expectedPrice !== ('' as unknown)) {
    const price = toFiniteNumber(input.expectedPrice);
    if (price === null || price < 0) errors.push({ field: 'expectedPrice', message: 'Очікувана ціна: число ≥ 0' });
  }
  return errors;
}

export function validateHostingPaymentInput(input: Partial<HostingPayment>): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [
    ...validateRequiredText(input.serviceId, 'serviceId', 'Послуга хостингу', 120),
    ...validateAmount(input.amount, { field: 'amount', label: 'Сума', min: 0 }),
    ...validateDate(input.date, { field: 'date', label: 'Дата оплати', required: true }),
    ...validateDate(input.periodStart, { field: 'periodStart', label: 'Початок періоду', required: true }),
    ...validateDate(input.periodEnd, { field: 'periodEnd', label: 'Кінець періоду', required: true }),
  ];
  if (input.currency !== undefined && input.currency !== '' && !(HOSTING_CURRENCIES as readonly string[]).includes(String(input.currency))) {
    errors.push({ field: 'currency', message: 'Валюта: UAH, USD або EUR' });
  }
  const amount = toFiniteNumber(input.amount);
  if (amount !== null && amount <= 0) errors.push({ field: 'amount', message: 'Сума: має бути більшою за 0' });
  const start = typeof input.periodStart === 'string' ? input.periodStart : '';
  const end = typeof input.periodEnd === 'string' ? input.periodEnd : '';
  if (start && end && start > end) errors.push({ field: 'periodEnd', message: 'Кінець періоду не може бути ранішим за початок' });
  return errors;
}
