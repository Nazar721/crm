import type { DashboardStats, DataSnapshot } from '@/types';
import {
  bankAmountToDisplay,
  bankBalances,
  dashboardStats,
  project as calcProject,
  savingsProgress,
  savingsSummary,
  toDisplay,
} from '@/lib/calc';
import { incomeForMonth } from '@/lib/income-report';
import { accountBalances } from '@/lib/assistant/balance-report';
import { monthKeyOf } from '@/lib/dates';
import { formatMoney, getMonthKey, getMonthLabel, itemCurrency, today } from '@/lib/utils';

/**
 * Чистий view-model головної. Лежить у lib і не знає ні про React, ні про CSS:
 * сторінка лише рендерить ці дані, фінансова логіка не дублюється.
 *
 * Правила агрегації — точна копія тих, що були в app/dashboard/page.tsx:
 * - підпис proєкту: endDate → finishDate → createdAt;
 * - транзакції: без hidden, без source 'project_…', за date || plannedDate;
 * - дохід агенції: incomeForMonth() за чинною формулою.
 * Нічого з цього не складається з іншого показника.
 */

export interface DashboardMonthData {
  income: number;
  count: number;
  financeIn: number;
  financeOut: number;
}

export interface SavingsGoalRow {
  id: string;
  name: string;
  amount: number;
  goal: number;
  progress: number;
  currency: string;
  bank: string;
  date: string;
}

export interface DashboardView {
  stats: DashboardStats;
  /** Ключі останніх 12 місяців у хронологічному порядку. */
  monthKeys: string[];
  labels: string[];
  md: Record<string, DashboardMonthData>;
  /** Серії 1–4 для графіків; індекс відповідає labels. */
  series: {
    completedPaid: number[];
    completedCount: number[];
    financeIn: number[];
    financeOut: number[];
  };
  balances: Record<string, number>;
  /**
   * Рахунки одним списком: початкова сума з валютою рахунку і еквівалент у
   * валюті відображення — розділені підписи. Джерело: bankBalances() у UAH,
   * зворотна конвертація — чинна, як в assistant/balance-report.
   */
  accounts: ReturnType<typeof accountBalances>;
  sav: ReturnType<typeof savingsSummary>;
  savedItems: SavingsGoalRow[];
  /** Серія 3: джерела клієнтів. */
  sources: { labels: string[]; data: number[]; colors: string[] };
  agencyLabels: string[];
  agencyIncome: number[];
  currentMonthAgencyIncome: number;
  /**
   * Витрати поточного місяця — чинний звіт incomeForMonth().financeExpenses
   * (без hidden, без source 'project_…', за date || plannedDate).
   * НЕ різниця прибутків чи балансів.
   */
  monthExpenses: number;
  /** Поточний місяць за Europe/Kyiv (YYYY-MM). */
  monthKey: string;
  /** Підпис поточного місяця, напр. «жовтень 2026». */
  monthLabel: string;
  /** Валюта відображення — для підпису сум і еквівалентів рахунків. */
  displayCurrency: string;
}

/**
 * Вікно останніх 12 місяців. Якір — облікова дата Europe/Kyiv, тобто та сама
 * одиниця, що й у getMonthKey/today; раніше вікно збиралося з локального
 * поясу пристрою і біля межі місяця могло не збігатися з бакетами даних.
 * На пристрої в поясі Kyiv перелік місяців не змінюється.
 *
 * `ref` потрібен лише для детермінованих тестів/знімків; у застосунку
 * викликається без аргументів.
 */
export function last12Months(ref: Date = new Date()): Record<string, DashboardMonthData> {
  const data: Record<string, DashboardMonthData> = {};
  const anchor = monthKeyOf(ref);
  const [year, month] = anchor
    ? [Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7))]
    : [ref.getFullYear(), ref.getMonth() + 1];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    data[key] = { income: 0, count: 0, financeIn: 0, financeOut: 0 };
  }
  return data;
}

/**
 * Кольори джерел клієнтів: єдина графітова система з акцентом.
 * Зелений/червоний тут не використовуються — вони зарезервовані
 * за фінансовим і статусним значенням.
 */
const SOURCE_COLORS: Record<string, string> = {
  Telegram: '#FF7A42',
  Instagram: '#E8BD69',
  YouTube: '#F48891',
  Реклама: '#70747C',
  Сайт: '#ACACBB',
  'Сарафанне радіо': '#8E93A3',
  Інше: '#7C8194',
};
const SOURCE_FALLBACK = '#7C8194';

export function buildDashboardView(snapshot: DataSnapshot, ref: Date = new Date()): DashboardView {
  const stats = dashboardStats(snapshot);
  const settings = snapshot.financeSettings;
  const monthKey = monthKeyOf(ref) ?? today().slice(0, 7);

  const md = last12Months(ref);
  for (const p of snapshot.projectsCompleted) {
    const key = getMonthKey(p.endDate || p.finishDate || p.createdAt?.split('T')[0] || '');
    if (!key || !md[key]) continue;
    md[key].count += 1;
    md[key].income += toDisplay(calcProject(p).paidAmount, itemCurrency(p), settings);
  }
  for (const t of snapshot.transactions) {
    // Приховані записи виключаються — так само, як у балансі.
    if (t.hidden) continue;
    if (t.source && String(t.source).startsWith('project_')) continue;
    const key = getMonthKey(t.date || t.plannedDate);
    if (!key || !md[key]) continue;
    if (t.type === 'income') md[key].financeIn += bankAmountToDisplay(t.amount, t.bank, settings);
    else if (t.type === 'expense') md[key].financeOut += bankAmountToDisplay(t.amount, t.bank, settings);
  }

  const monthKeys = Object.keys(md);
  const labels = monthKeys.map(k => getMonthLabel(k));

  const srcMap: Record<string, number> = {};
  for (const c of snapshot.clients) {
    const s = c.source || 'Інше';
    srcMap[s] = (srcMap[s] || 0) + 1;
  }

  const agencyMonthKeys = monthKeys;
  const agencyIncome = agencyMonthKeys.map(key => incomeForMonth(snapshot, key).agencyIncome);

  const monthReport = incomeForMonth(snapshot, monthKey);

  return {
    stats,
    monthKeys,
    labels,
    md,
    series: {
      completedPaid: monthKeys.map(k => md[k].income),
      completedCount: monthKeys.map(k => md[k].count),
      financeIn: monthKeys.map(k => md[k].financeIn),
      financeOut: monthKeys.map(k => md[k].financeOut),
    },
    balances: bankBalances(snapshot.transactions, settings),
    accounts: accountBalances(snapshot),
    sav: savingsSummary(snapshot.savings, settings),
    savedItems: snapshot.savings.map(s => ({
      id: s.id,
      name: s.name || s.bank || 'Ціль',
      amount: Number(s.amount) || 0,
      goal: Number(s.goal) || 0,
      progress: savingsProgress(Number(s.amount) || 0, Number(s.goal) || 0),
      currency: s.currency || 'UAH',
      bank: s.bank || '',
      date: s.date || '',
    })),
    sources: {
      labels: Object.keys(srcMap),
      data: Object.values(srcMap),
      colors: Object.keys(srcMap).map(l => SOURCE_COLORS[l] || SOURCE_FALLBACK),
    },
    agencyLabels: agencyMonthKeys.map(k => getMonthLabel(k)),
    agencyIncome,
    currentMonthAgencyIncome: monthReport.agencyIncome,
    monthExpenses: monthReport.financeExpenses,
    monthKey,
    monthLabel: getMonthLabel(monthKey),
    displayCurrency: settings.displayCurrency || 'UAH',
  };
}

/** Текстовий підсумок для графіка «Рух коштів» — щоб сенс не залежав від canvas. */
export function cashFlowSummary(v: DashboardView): string {
  const totalIn = v.series.financeIn.reduce((a, b) => a + b, 0);
  const totalOut = v.series.financeOut.reduce((a, b) => a + b, 0);
  const curIn = v.md[v.monthKey]?.financeIn ?? 0;
  const curOut = v.md[v.monthKey]?.financeOut ?? 0;
  const money = (n: number) => formatMoney(n);
  return `Останні 12 місяців: надходження ${money(totalIn)}, витрати ${money(totalOut)}. `
    + `Поточний місяць (неповний): надходження ${money(curIn)}, витрати ${money(curOut)}.`;
}
