'use client';
import { useState, useMemo, useRef, type ReactNode } from 'react';
import { useApp } from '@/context/AppContext';
import { buildDashboardView, type DashboardView } from '@/lib/dashboard-view';
import { formatMoney } from '@/lib/utils';
import dynamic from 'next/dynamic';
import Modal from '@/components/ui/Modal';
import { useRevealCards } from '@/hooks/useViewportMotion';
import AnimatedNumber from '@/components/ui/AnimatedNumber';
import ChartViewport from '@/components/ui/ChartViewport';
import AnimatedSegmentedControl from '@/components/ui/AnimatedSegmentedControl';

const IncomeChart = dynamic(() => import('@/components/charts/IncomeChart'), { ssr: false });
const ProjectsBarChart = dynamic(() => import('@/components/charts/ProjectsBarChart'), { ssr: false });
const SourcesChart = dynamic(() => import('@/components/charts/SourcesChart'), { ssr: false });
const FinanceBarChart = dynamic(() => import('@/components/charts/FinanceBarChart'), { ssr: false });
const BankBalancesChart = dynamic(() => import('@/components/charts/BankBalancesChart'), { ssr: false });
const SavingsChart = dynamic(() => import('@/components/charts/SavingsChart'), { ssr: false });
const AgencyIncomeChart = dynamic(() => import('@/components/charts/AgencyIncomeChart'), { ssr: false });

/* Іконки: 24×24 viewBox, малюються 16–20 px — без кольорових плиток. */
const I = (d: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const ICONS: Record<string, ReactNode> = {
  active: I(<><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></>),
  completed: I(<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>),
  clients: I(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  specialists: I(<><path d="M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="20" cy="8" r="3" /><path d="M21 12v2" /><path d="M22.5 11h-1" /></>),
  partners: I(<><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M20 8v6" /><path d="M23 11h-6" /></>),
};

interface Metric { id: string; label: string; value: number; note: string; }
interface ScaleItem { id: string; label: string; value: string; icon: string; }

const money = (n: number) => formatMoney(n);
const whole = (n: number) => new Intl.NumberFormat('uk-UA').format(Math.round(n));
const ukDate = (d = new Date()) => d.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/* Підпис періоду — щоб жоден показник не звучав без контексту часу. */
const MONTH_NOTE = 'за поточний місяць';
const ALL_TIME_NOTE = 'за весь час';
const TODAY_NOTE = 'на сьогодні';

export default function DashboardPage() {
  const pageRef = useRef<HTMLElement>(null);
  useRevealCards(pageRef, '.ov-card, .ov-hero');
  const { snapshot } = useApp();
  const [showAgency, setShowAgency] = useState(false);
  const [showAssets, setShowAssets] = useState(false);
  const [doneMode, setDoneMode] = useState<'paid' | 'count'>('paid');
  const [flowMode, setFlowMode] = useState<'both' | 'in' | 'out'>('both');
  const [savingsTab, setSavingsTab] = useState<'goals' | 'total'>('goals');

  const view: DashboardView = useMemo(() => buildDashboardView(snapshot), [snapshot]);
  const s = view.stats;
  const series = view.series;

  /* Агенція → компактні фінанси: п'ять показників в одній панелі. */
  const agencyMoney: Metric[] = [
    { id: 'total-budget', label: 'Загальний бюджет', value: s.totalBudget, note: ALL_TIME_NOTE },
    { id: 'net-profit', label: 'Чистий прибуток', value: s.netProfit, note: ALL_TIME_NOTE },
    { id: 'avg-check', label: 'Середній чек', value: s.avgCheck, note: ALL_TIME_NOTE },
    { id: 'client-debts', label: 'Борг клієнтів', value: s.clientDebts, note: TODAY_NOTE },
    { id: 'specialist-debts', label: 'До виплати фахівцям', value: s.specialistDebts, note: TODAY_NOTE },
  ];

  /* Масштаб роботи: менша типографіка, іконки без кольорових квадратів. */
  const scale: ScaleItem[] = [
    { id: 'stat-active', label: 'Активні', value: whole(s.activeCount), icon: 'active' },
    { id: 'stat-completed', label: 'Завершені', value: whole(s.completedCount), icon: 'completed' },
    { id: 'stat-clients', label: 'Клієнти', value: whole(s.clientsCount), icon: 'clients' },
    { id: 'stat-specialists', label: 'Фахівці', value: whole(s.specialistsCount), icon: 'specialists' },
    { id: 'stat-partners', label: 'Партнери', value: whole(s.partnersCount), icon: 'partners' },
  ];

  const accounts = view.accounts.filter((a) => Math.abs(a.displayEquivalent.amount) > 0.004);
  const goalProgress = view.sav.totalGoal > 0 ? Math.min(100, (view.sav.totalSaved / view.sav.totalGoal) * 100) : 0;

  return (
    <section ref={pageRef} className="page ov-page active">
      {/* 1. Шапка */}
      <header className="ov-header">
        <div>
          <h1 className="ov-title">Огляд</h1>
          <p className="ov-subtitle">{ukDate()}</p>
        </div>
      </header>

      {/* ========== МОЇ ФІНАНСИ ========== */}
      <section className="ov-section" aria-labelledby="ov-sec-finance">
        <div className="ov-section-head">
          <h2 className="ov-section-title" id="ov-sec-finance">Мої фінанси</h2>
          <button type="button" className="ov-sec-action" aria-expanded={showAssets} aria-controls="ov-assets"
            onClick={() => setShowAssets((v) => !v)}>
            Графік активів
          </button>
        </div>

        <div className="ov-row ov-row--57">
          <article className="ov-card ov-card--balance-highlight">
            <div className="ov-card-head">
              <div>
                <span className="ov-wallet-kicker">МОЇ РАХУНКИ</span>
                <h3 className="ov-card-title">Доступний баланс</h3>
              </div>
              <span className="ov-wallet-currency">{view.displayCurrency}</span>
            </div>
            <div className="ov-wallet-hero">
              <div className="ov-balance-value"><AnimatedNumber value={s.balance} format={money} /></div>
              <div className="ov-wallet-art" aria-hidden="true"><i /><i /><i /></div>
            </div>
            <div className="ov-wallet-list-head"><span>Рахунки</span><span>{accounts.length} активні</span></div>
            <ul className="ov-accts">
              {accounts.map((a) => (
                <li className="ov-acct" key={a.id} data-bank={a.id}>
                  <span className="ov-acct-brand"><span className="ov-acct-mark">{a.label.slice(0, 1)}</span><span className="ov-acct-label">{a.label}</span></span>
                  <span className="ov-acct-nums">
                    <span className="ov-acct-native">{formatMoney(a.native.amount, a.native.currency)}</span>
                    {a.native.currency !== a.displayEquivalent.currency ? (
                      <span className="ov-acct-eq">
                        еквівалент {formatMoney(a.displayEquivalent.amount, a.displayEquivalent.currency)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
              {accounts.length === 0 ? <li className="ov-acct ov-acct--empty">Руху по рахунках ще немає</li> : null}
            </ul>
          </article>

          <article className="ov-card">
            <div className="ov-card-head">
              <h3 className="ov-card-title">Надходження / Витрати</h3>
              <AnimatedSegmentedControl
                label="Серія графіка руху коштів"
                value={flowMode}
                options={[{ value: 'both', label: 'Разом' }, { value: 'in', label: 'Надходження' }, { value: 'out', label: 'Витрати' }]}
                onChange={setFlowMode}
              />
            </div>
            <ChartViewport><FinanceBarChart labels={view.labels} incomeData={series.financeIn} expenseData={series.financeOut} mode={flowMode} /></ChartViewport>
            <p className="ov-card-foot">Останні 12 місяців. Поточний місяць неповний.</p>
          </article>
        </div>

        <div className="ov-row ov-row--even">
          <article className="ov-card ov-card--sum ov-card--income">
            <span className="ov-sum-label">Надходження за місяць</span>
            <span className="ov-sum-value"><AnimatedNumber value={s.monthIncome} format={money} /></span>
            <span className="ov-sum-note">{view.monthLabel} · {MONTH_NOTE}</span>
          </article>
          <article className="ov-card ov-card--sum ov-card--expense">
            <span className="ov-sum-label">Витрати за місяць</span>
            <span className="ov-sum-value"><AnimatedNumber value={view.monthExpenses} format={money} /></span>
            <span className="ov-sum-note">{view.monthLabel} · {MONTH_NOTE}</span>
          </article>
        </div>

        {showAssets ? (
          <div className="ov-row ov-row--full" id="ov-assets">
            <article className="ov-card">
              <div className="ov-card-head">
                <h3 className="ov-card-title">Активи рахунків</h3>
              </div>
              <ChartViewport><BankBalancesChart balances={view.balances} /></ChartViewport>
              <p className="ov-card-foot">Неприховані транзакції, у гривневому еквіваленті.</p>
            </article>
          </div>
        ) : null}
      </section>

      {/* ========== АГЕНЦІЯ ========== */}
      <section className="ov-section" aria-labelledby="ov-sec-agency">
        <div className="ov-section-head">
          <h2 className="ov-section-title" id="ov-sec-agency">Агенція</h2>
        </div>

        {/* Перший ряд: 5/7 + 7/12, gap 16 px */}
        <div className="ov-row ov-row--57 ov-row--lead">
          <article className="ov-hero">
            <span className="ov-hero-label">Мій дохід від агенції</span>
            <span className="ov-hero-value"><AnimatedNumber value={view.currentMonthAgencyIncome} format={money} /></span>
            <span className="ov-hero-month">{view.monthLabel} · {MONTH_NOTE}</span>
            <button type="button" className="ov-hero-action" onClick={() => setShowAgency(true)} aria-haspopup="dialog">
              Деталізація <span aria-hidden="true">→</span>
            </button>
          </article>

          <article className="ov-card ov-card--lead">
            <div className="ov-card-head">
              <h3 className="ov-card-title">Завершені проєкти</h3>
              <AnimatedSegmentedControl
                label="Серія графіка завершених проєктів"
                value={doneMode}
                options={[{ value: 'paid', label: 'Оплати' }, { value: 'count', label: 'Кількість' }]}
                onChange={setDoneMode}
              />
            </div>
            {doneMode === 'paid'
              ? <ChartViewport><IncomeChart labels={view.labels} data={series.completedPaid} /></ChartViewport>
              : <ChartViewport><ProjectsBarChart labels={view.labels} data={series.completedCount} /></ChartViewport>}
            <p className="ov-card-foot">
              {doneMode === 'paid'
                ? 'Оплати за завершені проєкти, за місяцем завершення. Це не дохід агенції.'
                : 'Скільки проєктів завершено щомісяця.'}
            </p>
          </article>
        </div>

        {/* Другий ряд: 7/12 + 5/12 */}
        <div className="ov-row ov-row--75">
          <article className="ov-card ov-card--agency-money">
            <div className="ov-card-head">
              <h3 className="ov-card-title">Фінанси агенції</h3>
            </div>
            <div className="ov-metrics">
              {agencyMoney.map((m) => (
                <div className="ov-metric" key={m.id}>
                  <span className="ov-metric-label">{m.label}</span>
                  <span className="ov-metric-value"><AnimatedNumber value={m.value} format={money} /></span>
                  <span className="ov-metric-note">{m.note}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="ov-card ov-card--client-source">
            <div className="ov-card-head">
              <h3 className="ov-card-title">Джерела клієнтів</h3>
            </div>
            <ChartViewport><SourcesChart labels={view.sources.labels} data={view.sources.data} colors={view.sources.colors} /></ChartViewport>
            <p className="ov-card-foot">За кількістю клієнтів, без фільтрації за періодом.</p>
          </article>
        </div>

        {/* Третій ряд: на всю ширину */}
        <div className="ov-row ov-row--full">
          <article className="ov-card ov-card--scale">
            <div className="ov-card-head">
              <h3 className="ov-card-title">Масштаб роботи</h3>
            </div>
            <ul className="ov-scale">
              {scale.map((k, i) => (
                <li className="ov-scale-item" key={k.id} data-sep={i > 0 ? 'true' : undefined}>
                  <span className="ov-scale-icon">{ICONS[k.icon]}</span>
                  <span className="ov-scale-label">{k.label}</span>
                  <span className="ov-scale-value">{k.value}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      {/* ========== Відкладення + Особисті борги ========== */}
      <div className="ov-row ov-row--even">
        <article className="ov-card ov-card--savings" aria-labelledby="ov-savings-t">
          <div className="ov-card-head">
            <h3 className="ov-card-title" id="ov-savings-t">Відкладення та цілі</h3>
            <AnimatedSegmentedControl
              label="Вигляд відкладень"
              value={savingsTab}
              options={[{ value: 'goals', label: 'По цілях' }, { value: 'total', label: 'Загальний' }]}
              onChange={setSavingsTab}
            />
          </div>

          <div className="ov-sav-head">
            <div className="ov-sav-sums">
              <span className="ov-sav-total">{money(view.sav.totalSaved)}</span>
              <span className="ov-sav-goal">з {money(view.sav.totalGoal)}</span>
            </div>
            <span className="ov-sav-pct">{Math.round(goalProgress)}%</span>
          </div>
          <div className="ov-progress" role="img"
            aria-label={`Загальний прогрес відкладень: ${Math.round(goalProgress)} відсотків`}>
            <span className="ov-progress-bar" style={{ width: `${goalProgress}%` }} />
          </div>

          {savingsTab === 'goals' ? (
            view.savedItems.length ? (
              <ul className="ov-goals">
                {view.savedItems.map((g) => (
                  <li className="ov-goal" key={g.id}>
                    <div className="ov-goal-top">
                      <span className="ov-goal-name">{g.name}</span>
                      <span className="ov-goal-nums">
                        {money(g.amount)} <span className="ov-goal-of">з {money(g.goal)}</span>
                      </span>
                    </div>
                    <div className="ov-progress ov-progress--sm" role="img"
                      aria-label={`Ціль «${g.name}»: ${Math.round(g.progress)} відсотків`}>
                      <span className="ov-progress-bar" style={{ width: `${Math.min(100, g.progress)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ov-card-foot">Цілей ще не додано.</p>
            )
          ) : (
            <>
              <ChartViewport><SavingsChart labels={['Всього']} saved={[view.sav.totalSaved]}
                remaining={[Math.max(0, view.sav.totalGoal - view.sav.totalSaved)]} /></ChartViewport>
              <p className="ov-card-foot">
                Відкладено {money(view.sav.totalSaved)} з {money(view.sav.totalGoal)}; залишилось {money(Math.max(0, view.sav.totalGoal - view.sav.totalSaved))}.
              </p>
            </>
          )}
        </article>

        <article className="ov-card ov-card--debts" aria-labelledby="ov-debts-t">
          <div className="ov-card-head">
            <h3 className="ov-card-title" id="ov-debts-t">Особисті борги</h3>
          </div>
          <div className="ov-debts">
            <div className="ov-debt">
              <span className="ov-debt-label">Мені винні</span>
              <span className="ov-debt-value ov-debt-value--in">{money(s.owedToMe)}</span>
            </div>
            <div className="ov-debt">
              <span className="ov-debt-label">Я винен</span>
              <span className="ov-debt-value ov-debt-value--out">{money(s.myDebts)}</span>
            </div>
          </div>
          <p className="ov-card-foot">Особисті позики поза межами проєктів і рахунків агенції.</p>
        </article>
      </div>

      <Modal isOpen={showAgency} onClose={() => setShowAgency(false)} title="Мій дохід від агенції по місяцях" size="lg">
        <div className="ov-modal-stat">
          <span className="ov-modal-stat-label">Дохід за актуальний місяць</span>
          <span className="ov-modal-stat-value">{money(view.currentMonthAgencyIncome)}</span>
        </div>
        <ChartViewport><AgencyIncomeChart labels={view.agencyLabels} data={view.agencyIncome} /></ChartViewport>
        <div className="modal-footer"><button className="btn btn-ghost" onClick={() => setShowAgency(false)}>Закрити</button></div>
      </Modal>
    </section>
  );
}
