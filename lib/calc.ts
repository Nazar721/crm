import type {
  Client, ClientStats, DashboardStats, DataSnapshot, FinanceSettings,
  Partner, PartnerStats, PersonalDebt, Project, ProjectCalc, Saving,
  Specialist, SpecialistStats, Transaction,
} from '@/types';
import * as Storage from '@/lib/storage';
import { getMonthKey, displayCurrency, itemCurrency, daysBetween, today } from '@/lib/utils';
import { normalizeBank } from '@/lib/banks';
import { getSettings, rateFor } from '@/lib/settings';
import * as store from '@/lib/store';

export function project(p: Project): ProjectCalc {
  const budget = Number(p.budget) || 0;
  const prepayment = Number(p.prepayment) || 0;
  const paidToSpecialist = Number(p.paidToSpecialist) || 0;
  const myPercent = Number(p.myPercent ?? 0);
  const profitTaken = Number(p.profitTaken) || 0;
  const fopPercent = Number(p.fop) || 0;
  const partnerCommissionPercent = Number(p.partnerCommission) || 0;

  const fopAmount = Math.round(budget * fopPercent / 100);
  const partnerCommission = Math.round(budget * partnerCommissionPercent / 100);
  const totalDeductions = fopAmount + partnerCommission;
  const budgetAfterDeductions = budget - totalDeductions;

  const paidAmount = Math.min(budget, Math.max(prepayment, 0));
  const projectProfit = Math.round(budgetAfterDeductions * myPercent / 100);
  const myIncome = projectProfit;
  const receivedProfit = Math.round(paidAmount * myPercent / 100);
  const specialistCost = budgetAfterDeductions - projectProfit;
  const clientDebt = budget - prepayment;
  const specialistDebt = specialistCost - paidToSpecialist;
  const remainingPayment = budget - prepayment;
  const profitLeft = myIncome - profitTaken;

  return {
    budget, specialistCost, prepayment, paidToSpecialist, myPercent, profitTaken,
    fopPercent, fopAmount, partnerCommissionPercent, partnerCommission, budgetAfterDeductions,
    projectProfit, myIncome, clientDebt, specialistDebt, remainingPayment, profitLeft,
    paidAmount, receivedProfit,
  };
}

export function projectStartDate(p: Project): string {
  return p.startDate || p.createdAt?.split('T')[0] || '';
}

// Дата, з якої триває поточний відрізок роботи.
// Заповнена лише коли статус === 'В роботі'.
export function projectWorkStartDate(p: Project): string {
  if (p.status !== 'В роботі') return '';
  return (p.workStartDate || '').split('T')[0] || projectStartDate(p);
}

// Скільки днів дедлайну вже з'їдено: накопичені дні + поточний відрізок «В роботі».
export function projectDaysUsed(p: Project, todayDate: string): number {
  const accumulated = Number(p.workedDays) || 0;
  const from = projectWorkStartDate(p);
  if (!from) return accumulated;
  return accumulated + Math.max(0, daysBetween(from, todayDate));
}

export function projectEndDate(p: Project): string {
  return p.endDate || p.finishDate || '';
}

export function projectPaymentDate(p: Project): string {
  if (p.paymentDate) return p.paymentDate;
  const prepayment = Number(p.prepayment) || 0;
  if (prepayment > 0) {
    return projectStartDate(p) || projectEndDate(p) || p.createdAt?.split('T')[0] || '';
  }
  return projectEndDate(p) || projectStartDate(p) || p.createdAt?.split('T')[0] || '';
}

// ============================================================
// Індекси за ID: один snapshot → один прохід. Сторінки будують контекст
// один раз на snapshot і передають його в статистику.
// ============================================================

export interface StatsContext {
  snapshot: DataSnapshot;
  settings: FinanceSettings;
  active: Project[];
  completed: Project[];
  allProjects: Project[];
  byClient: Map<string, Project[]>;
  bySpecialistActive: Map<string, Project[]>;
  bySpecialistCompleted: Map<string, Project[]>;
  byPartner: Map<string, Project[]>;
  clientsById: Map<string, Client>;
  specialistsById: Map<string, Specialist>;
  partnersById: Map<string, Partner>;
  clients: Client[];
  specialists: Specialist[];
  partners: Partner[];
  transactions: Transaction[];
  debts: PersonalDebt[];
  savings: Saving[];
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function createStatsContext(snapshot: DataSnapshot): StatsContext {
  const byClient = new Map<string, Project[]>();
  const bySpecialistActive = new Map<string, Project[]>();
  const bySpecialistCompleted = new Map<string, Project[]>();
  const byPartner = new Map<string, Project[]>();

  for (const p of snapshot.projectsActive) {
    if (p.clientId) pushInto(byClient, p.clientId, p);
    if (p.developerId) pushInto(bySpecialistActive, p.developerId, p);
    if (p.partnerId) pushInto(byPartner, p.partnerId, p);
  }
  for (const p of snapshot.projectsCompleted) {
    if (p.clientId) pushInto(byClient, p.clientId, p);
    if (p.developerId) pushInto(bySpecialistCompleted, p.developerId, p);
    if (p.partnerId) pushInto(byPartner, p.partnerId, p);
  }

  return {
    snapshot,
    settings: snapshot.financeSettings,
    active: snapshot.projectsActive,
    completed: snapshot.projectsCompleted,
    allProjects: [...snapshot.projectsActive, ...snapshot.projectsCompleted],
    byClient,
    bySpecialistActive,
    bySpecialistCompleted,
    byPartner,
    clientsById: new Map(snapshot.clients.map(c => [c.id, c])),
    specialistsById: new Map(snapshot.specialists.map(s => [s.id, s])),
    partnersById: new Map(snapshot.partners.map(p => [p.id, p])),
    clients: snapshot.clients,
    specialists: snapshot.specialists,
    partners: snapshot.partners,
    transactions: snapshot.transactions,
    debts: snapshot.personalDebts,
    savings: snapshot.savings,
  };
}

let cachedContext: { snapshot: DataSnapshot; ctx: StatsContext } | null = null;

/**
 * Один контекст на один snapshot: повторні виклики статистики в межах
 * одного рендеру не перечитують сховище і не перебудовують індекси.
 */
export function getStatsContext(snapshot?: DataSnapshot): StatsContext {
  const snap = snapshot ?? store.getSnapshot();
  if (cachedContext && cachedContext.snapshot === snap) return cachedContext.ctx;
  const ctx = createStatsContext(snap);
  cachedContext = { snapshot: snap, ctx };
  return ctx;
}

export function clientStats(clientId: string, ctx?: StatsContext): ClientStats {
  const c = ctx ?? getStatsContext();
  const all = c.byClient.get(clientId) ?? [];
  let totalBudget = 0, totalProfit = 0, totalPrepayment = 0, totalClientDebt = 0;
  for (const p of all) {
    const calc = project(p);
    const cur = itemCurrency(p);
    totalBudget += toDisplay(calc.budget, cur, c.settings);
    totalProfit += toDisplay(calc.projectProfit, cur, c.settings);
    totalPrepayment += toDisplay(calc.prepayment, cur, c.settings);
    totalClientDebt += toDisplay(calc.clientDebt, cur, c.settings);
  }
  return { count: all.length, totalBudget, totalProfit, totalPrepayment, clientDebt: totalClientDebt };
}

export function specialistStats(specialistId: string, ctx?: StatsContext): SpecialistStats {
  const c = ctx ?? getStatsContext();
  const active = c.bySpecialistActive.get(specialistId) ?? [];
  const completed = c.bySpecialistCompleted.get(specialistId) ?? [];
  let totalCost = 0, totalPaid = 0, debt = 0;
  for (const p of [...active, ...completed]) {
    const calc = project(p);
    const cur = itemCurrency(p);
    totalCost += toDisplay(calc.specialistCost, cur, c.settings);
    totalPaid += toDisplay(calc.paidToSpecialist, cur, c.settings);
    debt += toDisplay(calc.specialistDebt, cur, c.settings);
  }
  return { activeCount: active.length, count: completed.length, totalCost, totalPaid, debt };
}

export function partnerStats(partnerId: string, ctx?: StatsContext): PartnerStats {
  const c = ctx ?? getStatsContext();
  const all = c.byPartner.get(partnerId) ?? [];
  const clientIds = new Set(all.map(p => p.clientId).filter(Boolean));
  let totalDeals = 0, totalCommission = 0, ourIncome = 0;
  for (const p of all) {
    const calc = project(p);
    const cur = itemCurrency(p);
    totalDeals += toDisplay(calc.budget, cur, c.settings);
    totalCommission += toDisplay(calc.partnerCommission, cur, c.settings);
    ourIncome += toDisplay(calc.myIncome, cur, c.settings);
  }
  const partner = c.partnersById.get(partnerId);
  const pc = partner?.currency || 'UAH';
  const paidToPartner = toDisplay(Number(partner?.paidToPartner) || 0, pc, c.settings);
  const givenProjectsCount = Number(partner?.givenProjectsCount) || 0;
  const givenProjectsPrice = toDisplay(Number(partner?.givenProjectsPrice) || 0, pc, c.settings);
  const ourCommission = toDisplay(Number(partner?.ourCommission) || 0, pc, c.settings);
  const paidToUs = toDisplay(Number(partner?.paidToUs) || 0, pc, c.settings);
  return {
    clientsCount: clientIds.size,
    totalDeals,
    totalCommission,
    paidToPartner,
    partnerDebt: totalCommission - paidToPartner,
    ourIncome,
    givenProjectsCount,
    givenProjectsPrice,
    ourCommission,
    paidToUs,
    theirDebt: ourCommission - paidToUs,
  };
}

export function bankCurrencyLocal(bankId: string): string {
  const bank = normalizeBank(bankId);
  if (bank === 'cash_usd') return 'USD';
  if (bank === 'cash_eur') return 'EUR';
  if (bank === 'crypto_usdt') return 'USDT';
  return 'UAH';
}

/** Явні налаштування курсів: не читає localStorage під час конвертації. */
export function rateForCurrency(currency: string, settings: FinanceSettings = getSettings()): number {
  return rateFor(currency, settings);
}

export function bankAmountToUah(amount: number, bankId: string, settings: FinanceSettings = getSettings()): number {
  return (Number(amount) || 0) * rateForCurrency(bankCurrencyLocal(bankId), settings);
}

export function toDisplay(amount: number, currency?: string, settings: FinanceSettings = getSettings()): number {
  const a = Number(amount) || 0;
  const cur = currency || displayCurrency();
  const disp = settings.displayCurrency || 'UAH';
  if (cur === disp) return a;
  return a * rateForCurrency(cur, settings) / rateForCurrency(disp, settings);
}

export function bankAmountToDisplay(amount: number, bankId: string, settings: FinanceSettings = getSettings()): number {
  return toDisplay(bankAmountToUah(amount, bankId, settings), 'UAH', settings);
}

export function financeBalance(transactions?: Transaction[], settings: FinanceSettings = getSettings()): number {
  const balances = bankBalances(transactions, settings);
  return toDisplay(Object.values(balances).reduce((sum, amount) => sum + amount, 0), 'UAH', settings);
}

/** Баланс рахунків виключає приховані записи (hidden) — як і підсумки. */
export function bankBalances(transactions?: Transaction[], settings: FinanceSettings = getSettings()): Record<string, number> {
  const txns = transactions || Storage.getTransactions();
  const balances: Record<string, number> = { mono: 0, privat: 0, cash: 0, cash_usd: 0, cash_eur: 0, crypto_usdt: 0 };
  txns.forEach(t => {
    if (t.hidden) return;
    const bank = normalizeBank(t.bank);
    if (!bank) return;
    const amount = bankAmountToUah(t.amount, bank, settings);
    if (balances[bank] === undefined) balances[bank] = 0;
    if (t.type === 'income') balances[bank] += amount;
    else if (t.type === 'expense') balances[bank] -= amount;
    else if (t.type === 'transfer') {
      const toBank = normalizeBank(t.toBank);
      if (!toBank) return;
      balances[bank] -= amount;
      if (balances[toBank] === undefined) balances[toBank] = 0;
      balances[toBank] += bankAmountToUah(t.targetAmount ?? t.amount, toBank, settings);
    }
  });
  return balances;
}

export function personalDebtSummary(debts?: PersonalDebt[], settings: FinanceSettings = getSettings()): { owedToMe: number; myDebts: number } {
  const items = debts || Storage.getPersonalDebts();
  let owedToMe = 0, myDebts = 0;
  items.forEach(d => {
    const cur = d.currency || 'UAH';
    const amount = toDisplay(Number(d.amount) || 0, cur, settings);
    if (d.type === 'owed_to_me') owedToMe += amount;
    else if (d.type === 'my_debt') myDebts += amount;
  });
  return { owedToMe, myDebts };
}

export function savingsProgress(amount: number, goal: number): number {
  const g = Number(goal) || 0;
  if (!g) return 0;
  return Math.min(100, Math.round((Number(amount) || 0) / g * 100));
}

export function savingsSummary(items?: Saving[], settings: FinanceSettings = getSettings()): { totalSaved: number; totalGoal: number; progress: number; count: number } {
  const list = items || Storage.getSavings();
  let totalSaved = 0, totalGoal = 0;
  list.forEach(s => {
    const cur = s.currency || 'UAH';
    totalSaved += toDisplay(Number(s.amount) || 0, cur, settings);
    totalGoal += toDisplay(Number(s.goal) || 0, cur, settings);
  });
  return {
    totalSaved,
    totalGoal,
    progress: totalGoal > 0 ? Math.min(100, Math.round(totalSaved / totalGoal * 100)) : 0,
    count: list.length,
  };
}

export interface TransactionSummary {
  count: number;
  turnover: number;
  income: number;
  expense: number;
}

/**
 * Підсумки по ВСЬОМУ відфільтрованому набору (не по видимій сторінці).
 * Приховані записи виключаються — так само, як у балансі.
 */
export function summarizeTransactions(transactions: Transaction[], settings: FinanceSettings = getSettings()): TransactionSummary {
  let turnover = 0, income = 0, expense = 0, count = 0;
  for (const t of transactions) {
    if (t.hidden) continue;
    count += 1;
    if (t.type === 'transfer') continue;
    const v = bankAmountToDisplay(Number(t.amount) || 0, t.bank, settings);
    if (t.type === 'income') {
      turnover += v;
      if (t.incomeStatus !== 'incoming') income += v;
    } else if (t.type === 'expense') {
      expense += v;
    }
  }
  return { count, turnover, income, expense };
}

/** Дохід місяця: без прихованих записів і без проєктних транзакцій. */
export function monthIncome(transactions: Transaction[], monthKey: string, settings: FinanceSettings = getSettings()): number {
  let sum = 0;
  for (const t of transactions) {
    if (t.hidden) continue;
    if (t.type !== 'income') continue;
    const isProjectSource = t.source && String(t.source).startsWith('project_');
    if (isProjectSource) continue;
    if (t.incomeStatus === 'incoming') continue;
    if (getMonthKey(t.date || t.plannedDate) !== monthKey) continue;
    sum += bankAmountToDisplay(t.amount, t.bank, settings);
  }
  return sum;
}

export function dashboardStats(snapshot?: DataSnapshot): DashboardStats {
  const ctx = getStatsContext(snapshot);
  const settings = ctx.settings;

  let totalBudget = 0, totalProfit = 0;
  let clientDebts = 0, specialistDebts = 0, partnerDebts = 0;

  for (const p of ctx.completed) {
    const c = project(p);
    const cur = itemCurrency(p);
    totalBudget += toDisplay(c.budget, cur, settings);
    totalProfit += toDisplay(c.myIncome, cur, settings);
  }

  for (const p of ctx.allProjects) {
    const c = project(p);
    const cur = itemCurrency(p);
    clientDebts += toDisplay(c.clientDebt, cur, settings);
    specialistDebts += toDisplay(c.specialistDebt, cur, settings);
  }

  for (const pt of ctx.partners) {
    partnerDebts += partnerStats(pt.id, ctx).partnerDebt;
  }

  const pd = personalDebtSummary(ctx.debts, settings);
  const avgCheck = ctx.completed.length ? totalBudget / ctx.completed.length : 0;

  // Обліковий місяць за Europe/Kyiv (див. lib/dates).
  const monthKey = today().slice(0, 7);

  const savings = savingsSummary(ctx.savings, settings);

  return {
    totalBudget,
    netProfit: totalProfit,
    savingsTotal: savings.totalSaved,
    activeCount: ctx.active.length,
    completedCount: ctx.completed.length,
    avgCheck,
    clientsCount: ctx.clients.length,
    specialistsCount: ctx.specialists.length,
    partnersCount: ctx.partners.length,
    clientDebts,
    specialistDebts,
    partnerDebts,
    monthIncome: monthIncome(ctx.transactions, monthKey, settings),
    balance: financeBalance(ctx.transactions, settings),
    owedToMe: pd.owedToMe,
    myDebts: pd.myDebts,
  };
}
