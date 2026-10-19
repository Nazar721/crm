import type { DataSnapshot } from '@/types';
import { emptySnapshot } from '../helpers';
import { last12Months } from '@/lib/dashboard-view';

/**
 * Фіксований обліковий момент знімка: 19 жовтня 2026, 12:00 Europe/Kyiv.
 * Завдяки йому серії останніх 12 місяців не зсуваються з часом,
 * і «до/після» звіряється на однаковому вікні незалежно від дати запуску.
 */
export const SNAPSHOT_REF: Date = new Date('2026-10-19T09:00:00.000Z');

/** Ключі останніх 12 місяців у хронологічному порядку; [11] — поточний. */
export const MONTH_KEYS: string[] = Object.keys(last12Months(SNAPSHOT_REF));

/** Дата всередині місяця, безпечна для будь-якого місяця (день ≤ 28). */
export function dayIn(monthKey: string, day: number): string {
  return `${monthKey}-${String(day).padStart(2, '0')}`;
}

/**
 * Синтетичний snapshot для звірки головної «до/після».
 * Тестові дані: жодних реальних сум, клієнтів чи секретів.
 *
 * Покриває: кілька місяців вікна, різні валюти, hidden,
 * source 'project_…', incomeStatus 'incoming', трансфер, обидва типи
 * особистих боргів, кілька цілей відкладень і джерела клієнтів.
 */
export function dashboardFixture(): DataSnapshot {
  const s = emptySnapshot();
  s.financeSettings = { usdRate: 41, eurRate: 44, usdtRate: 41.5, displayCurrency: 'UAH' };

  const [m0, m1, m2, m3, , , , , , , m10, m11] = MONTH_KEYS;

  s.transactions = [
    // Поточний місяць: звичайний дохід і витрата.
    { id: 't1', type: 'income', amount: 50000, bank: 'mono', category: 'Проєкт', description: 'Оплата', date: dayIn(m11, 3), status: 'done', incomeStatus: 'earned' },
    { id: 't2', type: 'expense', amount: 7000, bank: 'mono', category: 'Реклама', description: 'Витрата', date: dayIn(m11, 7), status: 'done' },
    // Прихований запис — не входить у графік і підсумки.
    { id: 't3', type: 'income', amount: 4000, bank: 'mono', date: dayIn(m11, 8), hidden: true, status: 'done' },
    // Проєктне джерело — не входить у рух коштів.
    { id: 't4', type: 'income', amount: 9999, bank: 'mono', date: dayIn(m11, 9), source: 'project_x', status: 'done' },
    // Очікуване надходження: у графіку руху є, у звіті місячного доходу — ні.
    { id: 't5', type: 'income', amount: 2500, bank: 'mono', date: dayIn(m11, 10), incomeStatus: 'incoming', status: 'planned' },
    // Валютні рахунки.
    { id: 't6', type: 'income', amount: 1000, bank: 'cash_usd', date: dayIn(m10, 5), status: 'done', incomeStatus: 'earned' },
    { id: 't7', type: 'expense', amount: 400, bank: 'crypto_usdt', date: dayIn(m10, 11), status: 'done' },
    // Трансфер між рахунками.
    { id: 't8', type: 'transfer', amount: 10000, bank: 'mono', toBank: 'cash', targetAmount: 10000, date: dayIn(m2, 12), status: 'done' },
    // Край вікна — 11 місяців тому.
    { id: 't9', type: 'income', amount: 12345, bank: 'mono', date: dayIn(m0, 4), status: 'done', incomeStatus: 'earned' },
    { id: 't10', type: 'income', amount: 3000, bank: 'cash_eur', date: dayIn(m1, 6), status: 'done', incomeStatus: 'earned' },
  ];

  s.projectsCompleted = [
    { id: 'p1', name: 'Завершений UAH', type: 'IT', status: 'Завершено', startDate: dayIn(m11, 1), endDate: dayIn(m11, 5), clientId: '', clientName: 'Клієнт', budget: 100000, prepayment: 60000, paidToSpecialist: 10000, myPercent: 40, profitTaken: 0, fop: 10, partnerCommission: 0, currency: 'UAH' },
    { id: 'p2', name: 'Завершений USD', type: 'IT', status: 'Завершено', startDate: dayIn(m10, 1), finishDate: dayIn(m10, 6), clientId: '', clientName: 'Клієнт', budget: 1000, prepayment: 500, paidToSpecialist: 100, myPercent: 50, profitTaken: 0, fop: 0, partnerCommission: 0, currency: 'USD' },
    { id: 'p3', name: 'Без передоплати', type: 'IT', status: 'Завершено', startDate: dayIn(m2, 1), endDate: dayIn(m2, 7), clientId: '', clientName: 'Клієнт', budget: 50000, prepayment: 0, paidToSpecialist: 0, myPercent: 30, profitTaken: 0, fop: 0, partnerCommission: 0, currency: 'UAH' },
    { id: 'p4', name: 'Лише createdAt', type: 'IT', status: 'Завершено', createdAt: `${dayIn(m3, 1)}T00:00:00.000Z`, startDate: dayIn(m3, 1), clientId: '', clientName: 'Клієнт', budget: 20000, prepayment: 10000, paidToSpecialist: 0, myPercent: 25, profitTaken: 0, fop: 0, partnerCommission: 0, currency: 'UAH' },
  ];

  s.projectsActive = [
    { id: 'a1', name: 'Активний', type: 'IT', status: 'В роботі', startDate: dayIn(m11, 1), clientId: '', clientName: 'Клієнт', budget: 300000, prepayment: 150000, paidToSpecialist: 50000, myPercent: 35, profitTaken: 0, fop: 5, partnerCommission: 0, currency: 'UAH' },
    { id: 'a2', name: 'Активний 2', type: 'IT', status: 'В роботі', startDate: dayIn(m10, 1), clientId: '', clientName: 'Клієнт', budget: 80000, prepayment: 0, paidToSpecialist: 0, myPercent: 40, profitTaken: 0, fop: 0, partnerCommission: 0, currency: 'UAH' },
  ];

  s.clients = [
    { id: 'c1', name: 'Клієнт Telegram 1', source: 'Telegram', createdAt: '2026-01-10T10:00:00.000Z' },
    { id: 'c2', name: 'Клієнт Telegram 2', source: 'Telegram', createdAt: '2026-02-10T10:00:00.000Z' },
    { id: 'c3', name: 'Клієнт Instagram', source: 'Instagram', createdAt: '2026-03-10T10:00:00.000Z' },
    { id: 'c4', name: 'Клієнт Сайт', source: 'Сайт', createdAt: '2026-04-10T10:00:00.000Z' },
    { id: 'c5', name: 'Клієнт без джерела', createdAt: '2026-05-10T10:00:00.000Z' },
  ];

  s.specialists = [
    { id: 'sp1', name: 'Фахівець 1', specialization: 'Frontend' },
    { id: 'sp2', name: 'Фахівець 2', specialization: 'Backend' },
  ];

  s.partners = [
    { id: 'pt1', name: 'Партнер 1', currency: 'UAH', paidToPartner: 5000, ourCommission: 20000, paidToUs: 4000, givenProjectsCount: 2, givenProjectsPrice: 120000 },
  ];

  s.personalDebts = [
    { id: 'd1', type: 'owed_to_me', person: 'Одержу', amount: 15000, currency: 'UAH', date: '2026-06-01' },
    { id: 'd2', type: 'my_debt', person: 'Віддаю', amount: 800, currency: 'USD', date: '2026-06-02' },
  ];

  s.savings = [
    { id: 'sv1', name: 'Подушка', bank: 'mono', amount: 30000, goal: 100000, currency: 'UAH', date: '2026-05-01' },
    { id: 'sv2', name: 'Ноутбук', bank: 'cash_usd', amount: 500, goal: 2000, currency: 'USD', date: '2026-05-02' },
    { id: 'sv3', name: 'Без цілі', bank: 'crypto_usdt', amount: 100, goal: 0, currency: 'USDT', date: '2026-05-03' },
  ];

  return s;
}
