'use client';
import { useState, useMemo, type ReactNode } from 'react';
import { useApp } from '@/context/AppContext';
import { buildDashboardView, type DashboardView } from '@/lib/dashboard-view';
import { formatMoney } from '@/lib/utils';
import dynamic from 'next/dynamic';
import Modal from '@/components/ui/Modal';

const IncomeChart = dynamic(() => import('@/components/charts/IncomeChart'), { ssr: false });
const ProjectsBarChart = dynamic(() => import('@/components/charts/ProjectsBarChart'), { ssr: false });
const SourcesChart = dynamic(() => import('@/components/charts/SourcesChart'), { ssr: false });
const FinanceBarChart = dynamic(() => import('@/components/charts/FinanceBarChart'), { ssr: false });
const BankBalancesChart = dynamic(() => import('@/components/charts/BankBalancesChart'), { ssr: false });
const SavingsChart = dynamic(() => import('@/components/charts/SavingsChart'), { ssr: false });
const AgencyIncomeChart = dynamic(() => import('@/components/charts/AgencyIncomeChart'), { ssr: false });

/* Іконки: 24×24, stroke 2 — той самий набір, що й був на головній. */
const I = (d: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const ICONS: Record<string, ReactNode> = {
  profit: I(<><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></>),
  finance: I(<><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="12" y1="14" x2="12" y2="18" /><line x1="10" y1="16" x2="14" y2="16" /></>),
  agency: I(<><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7" /><line x1="7" y1="9" x2="17" y2="9" /><line x1="7" y1="13" x2="12" y2="13" /></>),
  budget: I(<><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7" /><line x1="7" y1="9" x2="17" y2="9" /><line x1="7" y1="13" x2="12" y2="13" /></>),
  avg: I(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="15" y2="17" /></>),
  balance: I(<><line x1="12" y1="2" x2="12" y2="22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  savings: I(<><path d="M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2" /><circle cx="10" cy="11" r="1" fill="currentColor" /><circle cx="14" cy="11" r="1" fill="currentColor" /></>),
  clientDebt: I(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  specDebt: I(<><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></>),
  owed: I(<><rect x="1" y="5" width="22" height="14" rx="2" /><line x1="1" y1="10" x2="23" y2="10" /><path d="M12 5v14" /></>),
  myDebts: I(<><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /><path d="M7 15h2" /><path d="M15 15h2" /></>),
  active: I(<><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></>),
  completed: I(<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>),
  clients: I(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  specialists: I(<><path d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="20" cy="8" r="3" /><path d="M21 12v2" /><path d="M22.5 11h-1" /></>),
  partners: I(<><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M20 8v6" /><path d="M23 11h-6" /></>),
};

type Tone = 'neutral' | 'accent' | 'income' | 'expense';

interface KpiRow { id: string; label: string; value: string; note?: string; icon: string; tone: Tone; }

const money = (n: number) => formatMoney(n);
const whole = (n: number) => new Intl.NumberFormat('uk-UA').format(Math.round(n));

const ukDate = (d = new Date()) => d.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/* Підпис періоду — щоб жоден показник не звучав без контексту часу. */
const MONTH_NOTE = 'за поточний місяць';
const ALL_TIME_NOTE = 'за весь час';

export default function DashboardPage() {
  const { snapshot } = useApp();
  const [showAgency, setShowAgency] = useState(false);
  const [flowMode, setFlowMode] = useState<'both' | 'in' | 'out' | 'net'>('both');
  const [savingsTab, setSavingsTab] = useState<'goals' | 'total'>('goals');

  const view: DashboardView = useMemo(() => buildDashboardView(snapshot), [snapshot]);
  const s = view.stats;

  const primary: KpiRow[] = [
    { id: 'net-profit', label: 'Чистий прибуток', value: money(s.netProfit), note: ALL_TIME_NOTE, icon: 'profit', tone: 'accent' },
    { id: 'month-income', label: 'Дохід у фінансах', value: money(s.monthIncome), note: MONTH_NOTE, icon: 'finance', tone: s.monthIncome >= 0 ? 'income' : 'expense' },
    { id: 'agency-income', label: 'Мій дохід від агенції', value: money(view.currentMonthAgencyIncome), note: MONTH_NOTE, icon: 'agency', tone: 'neutral' },
  ];

  const volume: KpiRow[] = [
    { id: 'stat-active', label: 'Активні проєкти', value: whole(s.activeCount), icon: 'active', tone: 'accent' },
    { id: 'stat-completed', label: 'Завершені', value: whole(s.completedCount), icon: 'completed', tone: 'neutral' },
    { id: 'stat-clients', label: 'Клієнти', value: whole(s.clientsCount), icon: 'clients', tone: 'neutral' },
    { id: 'stat-specialists', label: 'Фахівці', value: whole(s.specialistsCount), icon: 'specialists', tone: 'neutral' },
    { id: 'stat-partners', label: 'Партнери', value: whole(s.partnersCount), icon: 'partners', tone: 'neutral' },
  ];

  const moneyRows: KpiRow[] = [
    { id: 'total-budget', label: 'Загальний бюджет', value: money(s.totalBudget), note: ALL_TIME_NOTE, icon: 'budget', tone: 'neutral' },
    { id: 'avg-check', label: 'Середній чек', value: money(s.avgCheck), note: ALL_TIME_NOTE, icon: 'avg', tone: 'neutral' },
    { id: 'balance', label: 'Баланс', value: money(s.balance), icon: 'balance', tone: s.balance >= 0 ? 'income' : 'expense' },
    { id: 'savings', label: 'Відкладення', value: money(s.savingsTotal), icon: 'savings', tone: 'income' },
    { id: 'client-debts', label: 'Борг клієнтів', value: money(s.clientDebts), icon: 'clientDebt', tone: 'expense' },
    { id: 'specialist-debts', label: 'Борг фахівцям', value: money(s.specialistDebts), icon: 'specDebt', tone: 'expense' },
    { id: 'debt-owed', label: 'Борг мені', value: money(s.owedToMe), icon: 'owed', tone: 'income' },
    { id: 'my-debts', label: 'Мої борги', value: money(s.myDebts), icon: 'myDebts', tone: 'expense' },
  ];

  const dateLong = ukDate();
  const series = view.series;

  return (
    <section className="page ov-page active">
      {/* 1. Шапка */}
      <header className="ov-header">
        <div>
          <h1 className="ov-title">Огляд</h1>
          <p className="ov-subtitle">{dateLong}</p>
        </div>
      </header>

      {/* 2. Три ключові показники. Третя — кнопка: відкриває деталізацію агенції. */}
      <div className="ov-primary">
        {primary.map((k) => {
          const clickable = k.id === 'agency-income';
          return (
            <article key={k.id} className={`ov-kpi ov-kpi--${k.tone}${clickable ? ' ov-kpi--hit' : ''}`}>
              {clickable ? (
                <button type="button" className="ov-kpi-hit-btn" onClick={() => setShowAgency(true)} aria-haspopup="dialog">
                  <span className="ov-sr">Відкрити деталізацію доходу від агенції по місяцях</span>
                </button>
              ) : null}
              <div className="ov-kpi-top">
                <span className="ov-kpi-label">{k.label}</span>
                <span className={`ov-kpi-icon ov-kpi-icon--${k.tone}`}>{ICONS[k.icon]}</span>
              </div>
              <div className="ov-kpi-value">{k.value}</div>
              {k.note ? <div className="ov-kpi-note">{k.note}</div> : null}
              {clickable ? <span className="ov-kpi-hint" aria-hidden="true">Деталізація →</span> : null}
            </article>
          );
        })}
      </div>

      {/* 3. Обсяг роботи */}
      <section className="ov-block" aria-labelledby="ov-volume">
        <h2 className="ov-block-title" id="ov-volume">Обсяг роботи</h2>
        <div className="ov-cells ov-cells--5">
          {volume.map((k) => (
            <div key={k.id} className="ov-cell">
              <span className={`ov-cell-icon ov-cell-icon--${k.tone}`}>{ICONS[k.icon]}</span>
              <div className="ov-cell-body">
                <span className="ov-cell-label">{k.label}</span>
                <span className="ov-cell-value">{k.value}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Гроші та зобов'язання */}
      <section className="ov-block" aria-labelledby="ov-money">
        <h2 className="ov-block-title" id="ov-money">Гроші та зобов'язання</h2>
        <div className="ov-cells ov-cells--4">
          {moneyRows.map((k) => (
            <div key={k.id} className={`ov-cell ov-cell--${k.tone}`}>
              <span className={`ov-cell-icon ov-cell-icon--${k.tone}`}>{ICONS[k.icon]}</span>
              <div className="ov-cell-body">
                <span className="ov-cell-label">{k.label}</span>
                <span className="ov-cell-value">{k.value}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 5. Рух коштів */}
      <section className="ov-block" aria-labelledby="ov-flow">
        <div className="ov-block-head">
          <h2 className="ov-block-title" id="ov-flow">Рух коштів</h2>
          <div className="ov-seg" role="group" aria-label="Серія графіка руху коштів">
            {([['in', 'Надходження'], ['out', 'Витрати'], ['both', 'Обидва'], ['net', 'Сальдо']] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={flowMode === v}
                className={`ov-seg-item${flowMode === v ? ' is-on' : ''}`} onClick={() => setFlowMode(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="ov-panel">
          <FinanceBarChart labels={view.labels} incomeData={series.financeIn} expenseData={series.financeOut} mode={flowMode} />
          <p className="ov-panel-foot">
            Останні 12 місяців. Поточний місяць неповний. Сальдо — надходження мінус витрати.
          </p>
        </div>
      </section>

      {/* 6. Закриті замовлення + Кількість проєктів */}
      <div className="ov-two">
        <section className="ov-block" aria-labelledby="ov-closed">
          <h2 className="ov-block-title" id="ov-closed">Закриті замовлення</h2>
          <div className="ov-panel">
            <IncomeChart labels={view.labels} data={series.completedPaid} />
            <p className="ov-panel-foot">Сума оплат за завершені проєкти, за місяцем завершення.</p>
          </div>
        </section>
        <section className="ov-block" aria-labelledby="ov-count">
          <h2 className="ov-block-title" id="ov-count">Кількість проєктів</h2>
          <div className="ov-panel">
            <ProjectsBarChart labels={view.labels} data={series.completedCount} />
            <p className="ov-panel-foot">Скільки проєктів завершено щомісяця.</p>
          </div>
        </section>
      </div>

      {/* 7. Джерела клієнтів + Активи по банках */}
      <div className="ov-two">
        <section className="ov-block" aria-labelledby="ov-sources">
          <h2 className="ov-block-title" id="ov-sources">Джерела клієнтів</h2>
          <div className="ov-panel">
            <SourcesChart labels={view.sources.labels} data={view.sources.data} colors={view.sources.colors} />
            <p className="ov-panel-foot">За кількістю клієнтів, без фільтрації за періодом.</p>
          </div>
        </section>
        <section className="ov-block" aria-labelledby="ov-banks">
          <h2 className="ov-block-title" id="ov-banks">Активи по банках</h2>
          <div className="ov-panel">
            <BankBalancesChart balances={view.balances} />
            <p className="ov-panel-foot">Неприховані транзакції, у гривневому еквіваленті.</p>
          </div>
        </section>
      </div>

      {/* 8. Відкладення */}
      <section className="ov-block" aria-labelledby="ov-savings">
        <div className="ov-block-head">
          <h2 className="ov-block-title" id="ov-savings">Відкладення</h2>
          <div className="ov-seg" role="group" aria-label="Вигляд графіка відкладень">
            {([['goals', 'По цілях'], ['total', 'Загальний']] as const).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={savingsTab === v}
                className={`ov-seg-item${savingsTab === v ? ' is-on' : ''}`} onClick={() => setSavingsTab(v)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="ov-panel">
          {savingsTab === 'goals' ? (
            <>
              <SavingsChart
                labels={view.savedItems.map((x) => x.name)}
                saved={view.savedItems.map((x) => x.amount)}
                remaining={view.savedItems.map((x) => Math.max(0, x.goal - x.amount))}
              />
              <p className="ov-panel-foot">Кожна ціль окремо: скільки відкладено і скільки ще потрібно.</p>
            </>
          ) : (
            <>
              <SavingsChart
                labels={['Всього']}
                saved={[view.sav.totalSaved]}
                remaining={[Math.max(0, view.sav.totalGoal - view.sav.totalSaved)]}
              />
              <p className="ov-panel-foot">
                Загальний прогрес: {money(view.sav.totalSaved)} з {money(view.sav.totalGoal)}.
              </p>
            </>
          )}
        </div>
      </section>

      <Modal isOpen={showAgency} onClose={() => setShowAgency(false)} title="Мій дохід від агенції по місяцях" size="lg">
        <div className="ov-modal-stat">
          <span className="ov-modal-stat-label">Дохід за актуальний місяць</span>
          <span className="ov-modal-stat-value">{money(view.currentMonthAgencyIncome)}</span>
        </div>
        <AgencyIncomeChart labels={view.agencyLabels} data={view.agencyIncome} />
        <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setShowAgency(false)}>Закрити</button></div>
      </Modal>
    </section>
  );
}
