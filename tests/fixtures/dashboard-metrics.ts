import type { DataSnapshot } from '@/types';
import {
  bankAmountToDisplay,
  bankBalances,
  dashboardStats,
  project as calcProject,
  savingsSummary,
  toDisplay,
} from '@/lib/calc';
import { incomeForMonth } from '@/lib/income-report';
import { getMonthKey, itemCurrency } from '@/lib/utils';
import { monthKeyOf } from '@/lib/dates';
import { buildDashboardView, last12Months, type DashboardView } from '@/lib/dashboard-view';

/** Порядок фіксований — щоб JSON до/після звірявся позиція в позицію. */
export const KPI_IDS = [
  'total-budget', 'net-profit', 'avg-check', 'client-debts', 'specialist-debts',
  'stat-active', 'stat-completed', 'stat-clients', 'stat-partners', 'stat-specialists',
  'month-income', 'savings', 'balance', 'debt-owed', 'my-debts',
] as const;

export type KpiId = (typeof KPI_IDS)[number];

export interface DashboardMetrics {
  kpi: Record<KpiId, number>;
  agencyMonthIncome: number;
  /**
   * Сім чинних графічних наборів + окремий модальний графік агенції.
   * `cashFlow` — одна панель «Рух коштів» із двома серіями.
   */
  series: {
    completedPaid: number[];
    completedCount: number[];
    sources: { label: string; count: number }[];
    cashFlow: { income: number[]; expense: number[] };
    bankBalances: Record<string, number>;
    savingsGoals: { name: string; amount: number; goal: number }[];
    savingsTotals: { totalSaved: number; totalGoal: number };
    agencyIncome: number[];
  };
}

/** 15 KPI — напряму з чинної статистики, без проміжних перетворень. */
export function kpiFromStats(s: DataSnapshot): Record<KpiId, number> {
  const st = dashboardStats(s);
  return {
    'total-budget': st.totalBudget,
    'net-profit': st.netProfit,
    'avg-check': st.avgCheck,
    'client-debts': st.clientDebts,
    'specialist-debts': st.specialistDebts,
    'stat-active': st.activeCount,
    'stat-completed': st.completedCount,
    'stat-clients': st.clientsCount,
    'stat-partners': st.partnersCount,
    'stat-specialists': st.specialistsCount,
    'month-income': st.monthIncome,
    savings: st.savingsTotal,
    balance: st.balance,
    'debt-owed': st.owedToMe,
    'my-debts': st.myDebts,
  };
}

/**
 * Незалежний розрахунок семи графічних наборів — правила читаються тут
 * окремо від lib/dashboard-view, щоб перенесення коду не могло
 * непомітно змінити значення.
 */
export function referenceMetrics(s: DataSnapshot, ref: Date): DashboardMetrics {
  const settings = s.financeSettings;
  const md = last12Months(ref);
  const monthKeys = Object.keys(md);

  for (const p of s.projectsCompleted) {
    const key = getMonthKey(p.endDate || p.finishDate || p.createdAt?.split('T')[0] || '');
    if (!key || !md[key]) continue;
    md[key].count += 1;
    md[key].income += toDisplay(calcProject(p).paidAmount, itemCurrency(p), settings);
  }
  for (const t of s.transactions) {
    if (t.hidden) continue;
    if (t.source && String(t.source).startsWith('project_')) continue;
    const key = getMonthKey(t.date || t.plannedDate);
    if (!key || !md[key]) continue;
    if (t.type === 'income') md[key].financeIn += bankAmountToDisplay(t.amount, t.bank, settings);
    else if (t.type === 'expense') md[key].financeOut += bankAmountToDisplay(t.amount, t.bank, settings);
  }

  const srcMap: Record<string, number> = {};
  for (const c of s.clients) {
    const src = c.source || 'Інше';
    srcMap[src] = (srcMap[src] || 0) + 1;
  }

  const sav = savingsSummary(s.savings, settings);
  const monthKey = monthKeyOf(ref)!;

  return {
    kpi: kpiFromStats(s),
    agencyMonthIncome: incomeForMonth(s, monthKey).agencyIncome,
    series: {
      completedPaid: monthKeys.map(k => md[k].income),
      completedCount: monthKeys.map(k => md[k].count),
      sources: Object.keys(srcMap).map(label => ({ label, count: srcMap[label] })),
      cashFlow: {
        income: monthKeys.map(k => md[k].financeIn),
        expense: monthKeys.map(k => md[k].financeOut),
      },
      bankBalances: bankBalances(s.transactions, settings),
      savingsGoals: s.savings.map(g => ({
        name: g.name || g.bank || 'Ціль',
        amount: Number(g.amount) || 0,
        goal: Number(g.goal) || 0,
      })),
      savingsTotals: { totalSaved: sav.totalSaved, totalGoal: sav.totalGoal },
      agencyIncome: monthKeys.map(k => incomeForMonth(s, k).agencyIncome),
    },
  };
}

/** Та сама структура, але зібрана з view-model головної. */
export function metricsFromView(v: DashboardView): DashboardMetrics {
  return {
    kpi: kpiFromStatsOfView(v),
    agencyMonthIncome: v.currentMonthAgencyIncome,
    series: {
      completedPaid: v.series.completedPaid,
      completedCount: v.series.completedCount,
      sources: v.sources.labels.map((label, i) => ({ label, count: v.sources.data[i] })),
      cashFlow: { income: v.series.financeIn, expense: v.series.financeOut },
      bankBalances: v.balances,
      savingsGoals: v.savedItems.map(g => ({ name: g.name, amount: g.amount, goal: g.goal })),
      savingsTotals: { totalSaved: v.sav.totalSaved, totalGoal: v.sav.totalGoal },
      agencyIncome: v.agencyIncome,
    },
  };
}

function kpiFromStatsOfView(v: DashboardView): Record<KpiId, number> {
  const st = v.stats;
  return {
    'total-budget': st.totalBudget,
    'net-profit': st.netProfit,
    'avg-check': st.avgCheck,
    'client-debts': st.clientDebts,
    'specialist-debts': st.specialistDebts,
    'stat-active': st.activeCount,
    'stat-completed': st.completedCount,
    'stat-clients': st.clientsCount,
    'stat-partners': st.partnersCount,
    'stat-specialists': st.specialistsCount,
    'month-income': st.monthIncome,
    savings: st.savingsTotal,
    balance: st.balance,
    'debt-owed': st.owedToMe,
    'my-debts': st.myDebts,
  };
}

export function viewMetrics(s: DataSnapshot, ref: Date): DashboardMetrics {
  return metricsFromView(buildDashboardView(s, ref));
}
