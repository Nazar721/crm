import type { Project, ProjectCalc, ClientStats, SpecialistStats, PartnerStats, DashboardStats, Transaction, PersonalDebt, Saving } from '@/types';
import * as Storage from '@/lib/storage';
import { getMonthKey } from '@/lib/utils';
import { normalizeBank, bankCurrency as bankCurrencyFn } from '@/lib/banks';

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

export function clientStats(clientId: string): ClientStats {
  const all = Storage.getAllProjects().filter(p => p.clientId === clientId);
  let totalBudget = 0, totalProfit = 0, totalPrepayment = 0, totalClientDebt = 0;
  all.forEach(p => {
    const c = project(p);
    totalBudget += c.budget;
    totalProfit += c.projectProfit;
    totalPrepayment += c.prepayment;
    totalClientDebt += c.clientDebt;
  });
  return {
    count: all.length,
    totalBudget,
    totalProfit,
    totalPrepayment,
    clientDebt: totalClientDebt,
  };
}

export function specialistStats(specialistId: string): SpecialistStats {
  const active = Storage.getProjects().filter(p => p.developerId === specialistId);
  const completed = Storage.getCompleted().filter(p => p.developerId === specialistId);
  const all = [...active, ...completed];
  let totalCost = 0, totalPaid = 0;
  all.forEach(p => {
    const c = project(p);
    totalCost += c.specialistCost;
    totalPaid += c.paidToSpecialist;
  });
  return {
    activeCount: active.length,
    count: completed.length,
    totalCost,
    totalPaid,
    debt: all.reduce((sum, p) => sum + project(p).specialistDebt, 0),
  };
}

export function partnerStats(partnerId: string): PartnerStats {
  const all = Storage.getAllProjects().filter(p => p.partnerId === partnerId);
  const clientIds = new Set(all.map(p => p.clientId).filter(Boolean));
  let totalDeals = 0, totalCommission = 0, ourIncome = 0;
  all.forEach(p => {
    const c = project(p);
    totalDeals += c.budget;
    totalCommission += c.partnerCommission;
    ourIncome += c.myIncome;
  });
  const partner = Storage.getPartners().find(x => x.id === partnerId);
  const paidToPartner = Number(partner?.paidToPartner) || 0;
  const givenProjectsCount = Number(partner?.givenProjectsCount) || 0;
  const givenProjectsPrice = Number(partner?.givenProjectsPrice) || 0;
  const ourCommission = Number(partner?.ourCommission) || 0;
  const paidToUs = Number(partner?.paidToUs) || 0;
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
  return 'UAH';
}

export function rateForCurrency(currency: string): number {
  const settings = Storage.getFinanceSettings();
  if (currency === 'USD') return Number(settings.usdRate) || 41;
  if (currency === 'EUR') return Number(settings.eurRate) || 44;
  return 1;
}

export function bankAmountToUah(amount: number, bankId: string): number {
  return (Number(amount) || 0) * rateForCurrency(bankCurrencyLocal(bankId));
}

export function financeBalance(transactions?: Transaction[]): number {
  const balances = bankBalances(transactions);
  return Object.values(balances).reduce((sum, amount) => sum + amount, 0);
}

export function bankBalances(transactions?: Transaction[]): Record<string, number> {
  const txns = transactions || Storage.getTransactions();
  const balances: Record<string, number> = { mono: 0, privat: 0, cash: 0, cash_usd: 0, cash_eur: 0 };
  txns.forEach(t => {
    if (t.hidden) return;
    const bank = normalizeBank(t.bank);
    if (!bank) return;
    const amount = bankAmountToUah(t.amount, bank);
    if (t.type === 'income') balances[bank] += amount;
    else if (t.type === 'expense') balances[bank] -= amount;
    else if (t.type === 'transfer') {
      const toBank = normalizeBank(t.toBank);
      if (!toBank) return;
      balances[bank] -= amount;
      balances[toBank] = (balances[toBank] || 0) + bankAmountToUah(t.targetAmount ?? t.amount, toBank);
    }
  });
  return balances;
}

export function personalDebtSummary(debts?: PersonalDebt[]): { owedToMe: number; myDebts: number } {
  const items = debts || Storage.getPersonalDebts();
  let owedToMe = 0, myDebts = 0;
  items.forEach(d => {
    const amount = Number(d.amount) || 0;
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

export function savingsSummary(items?: Saving[]): { totalSaved: number; totalGoal: number; progress: number; count: number } {
  const list = items || Storage.getSavings();
  let totalSaved = 0, totalGoal = 0;
  list.forEach(s => {
    totalSaved += Number(s.amount) || 0;
    totalGoal += Number(s.goal) || 0;
  });
  return {
    totalSaved,
    totalGoal,
    progress: totalGoal > 0 ? Math.min(100, Math.round(totalSaved / totalGoal * 100)) : 0,
    count: list.length,
  };
}

export function dashboardStats(): DashboardStats {
  const active = Storage.getProjects();
  const completed = Storage.getCompleted();
  const all = [...active, ...completed];
  const clients = Storage.getClients();
  const specialists = Storage.getSpecialists();
  const partners = Storage.getPartners();
  const transactions = Storage.getTransactions();

  let totalBudget = 0, totalProfit = 0;
  let clientDebts = 0, specialistDebts = 0, partnerDebts = 0;

  completed.forEach(p => {
    const c = project(p);
    totalBudget += c.budget;
    totalProfit += Number(c.myIncome);
  });

  all.forEach(p => {
    const c = project(p);
    clientDebts += c.clientDebt;
    specialistDebts += c.specialistDebt;
  });

  partners.forEach(pt => {
    partnerDebts += partnerStats(pt.id).partnerDebt;
  });

  const pd = personalDebtSummary();
  const avgCheck = completed.length ? totalBudget / completed.length : 0;

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthIncome = transactions
    .filter(t => {
      const key = getMonthKey(t.date || t.plannedDate);
      if (key !== monthKey) return false;
      const isProjectSource = t.source && String(t.source).startsWith('project_');
      if (t.type === 'income' && !isProjectSource && t.incomeStatus === 'incoming') return false;
      return t.type === 'income' && !isProjectSource;
    })
    .reduce((sum, t) => sum + bankAmountToUah(t.amount, t.bank), 0);

  const savings = savingsSummary();

  return {
    totalBudget,
    netProfit: totalProfit,
    savingsTotal: savings.totalSaved,
    activeCount: active.length,
    completedCount: completed.length,
    avgCheck,
    clientsCount: clients.length,
    specialistsCount: specialists.length,
    partnersCount: partners.length,
    clientDebts,
    specialistDebts,
    partnerDebts,
    monthIncome,
    balance: financeBalance(transactions),
    owedToMe: pd.owedToMe,
    myDebts: pd.myDebts,
  };
}
