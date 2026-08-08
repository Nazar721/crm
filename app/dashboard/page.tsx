'use client';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { dashboardStats, project as calcProject, savingsSummary, bankBalances, bankAmountToUah } from '@/lib/calc';
import { getCompleted, getTransactions, getSavings, getClients } from '@/lib/storage';
import { formatMoney, getMonthKey, getMonthLabel, today } from '@/lib/utils';
import IncomeChart from '@/components/charts/IncomeChart';
import ProjectsBarChart from '@/components/charts/ProjectsBarChart';
import SourcesChart from '@/components/charts/SourcesChart';
import FinanceBarChart from '@/components/charts/FinanceBarChart';
import BankBalancesChart from '@/components/charts/BankBalancesChart';
import SavingsChart from '@/components/charts/SavingsChart';
import AgencyIncomeChart from '@/components/charts/AgencyIncomeChart';
import Modal from '@/components/ui/Modal';

interface MonthData { income: number; count: number; financeIn: number; financeOut: number; }
function last12Months(): Record<string, MonthData> {
  const data: Record<string, MonthData> = {};
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    data[key] = { income: 0, count: 0, financeIn: 0, financeOut: 0 };
  }
  return data;
}

const STAT_LABELS: Record<string, string> = {
  'total-budget': 'Загальний бюджет', 'net-profit': 'Чистий прибуток',
  'avg-check': 'Середній чек', 'client-debts': 'Борг клієнтів',
  'specialist-debts': 'Борг фахівцям', 'month-income': 'Дохід за місяць',
  'savings': 'Відкладення', 'balance': 'Баланс',
  'debt-owed': 'Борг мені', 'my-debts': 'Мої борги',
};

const STAT_COLORS: Record<string, string> = {
  'total-budget': 'blue', 'net-profit': 'teal', 'avg-check': 'orange',
  'client-debts': 'orange', 'specialist-debts': 'orange', 'month-income': 'gold',
  'savings': 'gold', 'balance': 'green', 'debt-owed': 'green', 'my-debts': 'orange',
};

export default function DashboardPage() {
  const { refreshKey } = useApp();
  const [showAgencyIncome, setShowAgencyIncome] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const data = useMemo(() => {
    if (!mounted) return null;
    const stats = dashboardStats();
    const completed = getCompleted();
    const transactions = getTransactions();
    const savingsItems = getSavings();
    const clients = getClients();

    const md = last12Months();
    completed.forEach(p => {
      const key = getMonthKey((p as any).endDate || (p as any).finishDate || (p as any).createdAt?.split('T')[0] || '');
      if (key && md[key]) { md[key].count += 1; md[key].income += calcProject(p as any).paidAmount; }
    });
    transactions.forEach(t => {
      if (t.source && String(t.source).startsWith('project_')) return;
      const key = getMonthKey(t.date || t.plannedDate);
      if (key && md[key]) {
        if (t.type === 'income') md[key].financeIn += bankAmountToUah(t.amount, t.bank);
        else if (t.type === 'expense') md[key].financeOut += bankAmountToUah(t.amount, t.bank);
      }
    });

    const labels = Object.keys(md).map(k => getMonthLabel(k));
    const balances = bankBalances();
    const sav = savingsSummary();
    const savedItems = savingsItems.map(s => ({ name: s.name || s.bank || 'Ціль', amount: Number(s.amount) || 0, goal: Number(s.goal) || 0 }));

    const srcMap: Record<string, number> = {};
    clients.forEach(c => { const s = c.source || 'Інше'; srcMap[s] = (srcMap[s] || 0) + 1; });
    const srcColors: Record<string, string> = { Telegram: '#4f9cf9', Instagram: '#f472b6', YouTube: '#fb923c', 'Реклама': '#a78bfa', 'Сайт': '#2dd4bf', 'Сарафанне радіо': '#34d399', 'Інше': '#555a70' };

    const amd = last12Months() as Record<string, { income: number }>;
    completed.forEach(p => {
      const key = getMonthKey((p as any).endDate || (p as any).finishDate || '');
      if (key && amd[key]) amd[key].income += Number(calcProject(p as any).myIncome);
    });
    const agencyLabels = Object.keys(amd).map(k => getMonthLabel(k));
    const agencyIncome = Object.values(amd).map(d => d.income);
    const cmKey = getMonthKey(today());
    const cmIncome = amd[cmKey || '']?.income || 0;

    return { stats, labels, md, balances, sav, savedItems, srcLabels: Object.keys(srcMap), srcData: Object.values(srcMap), srcColors: Object.keys(srcMap).map(l => srcColors[l] || '#555a70'), agencyLabels, agencyIncome, cmIncome };
  }, [mounted, refreshKey]);

  if (!data) return <section className="page active" style={{ padding: 34 }}><p style={{ color: 'var(--text-secondary)' }}>Завантаження...</p></section>;

  const counterKeys = ['total-budget', 'net-profit', 'avg-check', 'client-debts', 'specialist-debts', 'month-income', 'savings', 'balance', 'debt-owed', 'my-debts'] as const;
  const counterVals: Record<string, number> = {
    'total-budget': data.stats.totalBudget, 'net-profit': data.stats.netProfit, 'avg-check': data.stats.avgCheck,
    'client-debts': data.stats.clientDebts, 'specialist-debts': data.stats.specialistDebts,
    'month-income': data.stats.monthIncome, 'savings': data.stats.savingsTotal, 'balance': data.stats.balance,
    'debt-owed': data.stats.owedToMe, 'my-debts': data.stats.myDebts,
  };

  return (
    <section className="page active">
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{new Date().toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
      </div>
      <div className="stats-grid stats-grid--wide">
        {counterKeys.map(id => (
          <div key={id} className={`stat-card${['client-debts', 'specialist-debts', 'debt-owed', 'my-debts'].includes(id) ? ' stat-card--warn' : ''}${id === 'month-income' ? ' stat-card--highlight stat-card--clickable' : ''}`}
            onClick={id === 'month-income' ? () => setShowAgencyIncome(true) : undefined}>
            <div className={`stat-icon stat-icon--${STAT_COLORS[id]}`}><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/></svg></div>
            <div className="stat-info"><span className="stat-label">{STAT_LABELS[id]}</span><span className="stat-value">{formatMoney(counterVals[id])}</span></div>
          </div>
        ))}
        {[
          ['stat-active', 'Активні проєкти', data.stats.activeCount, 'purple'],
          ['stat-completed', 'Завершені', data.stats.completedCount, 'indigo'],
          ['stat-clients', 'Клієнти', data.stats.clientsCount, 'pink'],
          ['stat-partners', 'Партнери', data.stats.partnersCount, 'purple'],
          ['stat-specialists', 'Фахівці', data.stats.specialistsCount, 'indigo'],
        ].map(([id, label, val, color]) => (
          <div key={id} className="stat-card">
            <div className={`stat-icon stat-icon--${color}`}><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="2"/></svg></div>
            <div className="stat-info"><span className="stat-label">{label}</span><span className="stat-value">{val}</span></div>
          </div>
        ))}
      </div>

      <h3 className="section-title">Проєкти</h3>
      <div className="charts-grid charts-grid--3">
        <div className="chart-card anim-chart"><div className="chart-header"><h3 className="chart-title">Закрито замовлень (сума за місяць)</h3></div><IncomeChart labels={data.labels} data={Object.values(data.md).map(d => d.income)} /></div>
        <div className="chart-card anim-chart"><div className="chart-header"><h3 className="chart-title">Кількість проєктів (місяць)</h3></div><ProjectsBarChart labels={data.labels} data={Object.values(data.md).map(d => d.count)} /></div>
        <div className="chart-card anim-chart"><div className="chart-header"><h3 className="chart-title">Джерела клієнтів</h3></div><SourcesChart labels={data.srcLabels} data={data.srcData} colors={data.srcColors} /></div>
      </div>

      <h3 className="section-title">Фінанси</h3>
      <div className="charts-grid charts-grid--2">
        <div className="chart-card anim-chart"><div className="chart-header"><h3 className="chart-title">Доходи / витрати</h3></div><FinanceBarChart labels={data.labels} incomeData={Object.values(data.md).map(d => d.financeIn)} expenseData={Object.values(data.md).map(d => d.financeOut)} /></div>
        <div className="chart-card anim-chart"><div className="chart-header"><h3 className="chart-title">Активи по банках</h3></div><BankBalancesChart balances={data.balances} /></div>
      </div>

      <h3 className="section-title">Відкладення</h3>
      <div className="charts-grid charts-grid--2">
        <div className="chart-card anim-chart"><div className="chart-header"><h3 className="chart-title">Прогрес по цілях</h3></div><SavingsChart labels={data.savedItems.map(s => s.name)} saved={data.savedItems.map(s => s.amount)} remaining={data.savedItems.map(s => Math.max(0, s.goal - s.amount))} /></div>
        <div className="chart-card anim-chart"><div className="chart-header"><h3 className="chart-title">Загальний прогрес</h3></div><SavingsChart labels={['Всього']} saved={[data.sav.totalSaved]} remaining={[Math.max(0, data.sav.totalGoal - data.sav.totalSaved)]} /></div>
      </div>

      <Modal isOpen={showAgencyIncome} onClose={() => setShowAgencyIncome(false)} title="Мій дохід від агенції по місяцях" size="lg">
        <div className="modal-stat-card"><div className="modal-stat-label">Дохід за актуальний місяць</div><div className="modal-stat-value">{formatMoney(data.cmIncome)}</div></div>
        <AgencyIncomeChart labels={data.agencyLabels} data={data.agencyIncome} />
        <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setShowAgencyIncome(false)}>Закрити</button></div>
      </Modal>
    </section>
  );
}
