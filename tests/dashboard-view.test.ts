import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import baseline from './fixtures/dashboard-metrics-baseline.json';
import { dashboardFixture, MONTH_KEYS, SNAPSHOT_REF } from './fixtures/dashboard-fixture';
import { KPI_IDS, referenceMetrics, viewMetrics, type DashboardMetrics } from './fixtures/dashboard-metrics';
import { buildDashboardView } from '@/lib/dashboard-view';
import { bankBalances, dashboardStats, monthIncome, savingsSummary } from '@/lib/calc';
import { incomeForMonth } from '@/lib/income-report';
import { monthKeyOf } from '@/lib/dates';

const fixture = dashboardFixture();
const CURRENT_MONTH = monthKeyOf(SNAPSHOT_REF)!;

test('головна: view-model віддає всі 15 KPI і дорівнює dashboardStats', () => {
  const view = viewMetrics(fixture, SNAPSHOT_REF);
  const stats = dashboardStats(fixture);
  assert.deepEqual(Object.keys(view.kpi), [...KPI_IDS], 'реєстр KPI незмінний і в тому ж порядку');
  assert.deepEqual(view.kpi, {
    'total-budget': stats.totalBudget,
    'net-profit': stats.netProfit,
    'avg-check': stats.avgCheck,
    'client-debts': stats.clientDebts,
    'specialist-debts': stats.specialistDebts,
    'stat-active': stats.activeCount,
    'stat-completed': stats.completedCount,
    'stat-clients': stats.clientsCount,
    'stat-partners': stats.partnersCount,
    'stat-specialists': stats.specialistsCount,
    'month-income': stats.monthIncome,
    savings: stats.savingsTotal,
    balance: stats.balance,
    'debt-owed': stats.owedToMe,
    'my-debts': stats.myDebts,
  });
});

test('головна: сім графічних наборів збігаються з незалежним розрахунком', () => {
  assert.deepEqual(viewMetrics(fixture, SNAPSHOT_REF), referenceMetrics(fixture, SNAPSHOT_REF), 'view ≡ reference');
});

test('головна: значення не змінилися від початкового snapshot', () => {
  const current = viewMetrics(fixture, SNAPSHOT_REF);
  const expected = baseline as DashboardMetrics;
  assert.equal(current.agencyMonthIncome, expected.agencyMonthIncome, 'дохід агенції за поточний місяць');
  for (const id of KPI_IDS) {
    assert.equal(current.kpi[id], expected.kpi[id], `KPI ${id}`);
  }
  assert.deepEqual(Object.keys(current.series), Object.keys(expected.series), 'набори серій');
  for (const [name, series] of Object.entries(current.series)) {
    assert.deepEqual(
      series,
      expected.series[name as keyof DashboardMetrics['series']],
      `серія ${name}`,
    );
  }
});

test('головна: вікно останніх 12 місяців і хронологія серій', () => {
  const view = buildDashboardView(fixture, SNAPSHOT_REF);
  assert.equal(view.monthKeys.length, 12);
  assert.deepEqual(view.monthKeys, [...view.monthKeys].sort(), 'місяці в хронологічному порядку');
  assert.deepEqual(view.monthKeys, MONTH_KEYS);
  assert.equal(view.monthKey, CURRENT_MONTH);
  for (const series of [view.series.completedPaid, view.series.completedCount, view.series.financeIn, view.series.financeOut, view.agencyIncome]) {
    assert.equal(series.length, 12, 'кожна серія має 12 точок');
  }
  assert.equal(view.labels.length, 12);
});

/**
 * Головний ризик редизайну — плутанина чотирьох різних сум.
 * Тут фіксується, що вони різні за джерелом і правилами.
 */
test('головна: дохід фінансів / дохід агенції / оплати завершених / чистий прибуток не змішуються', () => {
  const s = fixture;
  const st = dashboardStats(s);
  const month = incomeForMonth(s, CURRENT_MONTH);

  // 1) Дохід у фінансах — транзакції місяця без hidden/project_/incoming.
  assert.equal(st.monthIncome, monthIncome(s.transactions, CURRENT_MONTH, s.financeSettings));
  assert.equal(month.financeIncome, st.monthIncome, 'incomeForMonth і dashboardStats про один і той самий показник');

  // 2) Мій дохід від агенції — частка завершених проєктів за місяць.
  assert.equal(month.agencyIncome, buildDashboardView(s, SNAPSHOT_REF).currentMonthAgencyIncome);

  // 3) Оплати завершених — prepayment завершених проєктів, інша формула.
  //    За жовтень лише p1 (60000 UAH); USD-проєкт p2 завершено у вересні.
  assert.equal(month.closedCollected, 60000, 'оплати завершених за місяць');
  assert.equal(
    incomeForMonth(s, MONTH_KEYS[10]).closedCollected,
    Math.round(500 * 41),
    'USD-проєкт у чинному курсі, окремий місяць',
  );

  // 4) Чистий прибуток — моя частка по ВСІХ завершених, не за місяць.
  assert.ok(st.netProfit > 0);

  // Жодна пара не зводиться до однієї суми.
  assert.notEqual(month.financeIncome, month.agencyIncome, 'фінанси ≠ агенція');
  assert.notEqual(month.financeIncome, month.closedCollected, 'фінанси ≠ оплати завершених');
  assert.notEqual(month.agencyIncome, st.netProfit, 'агенція за місяць ≠ чистий прибуток за весь час');
  assert.notEqual(month.closedCollected, st.netProfit, 'оплати завершених ≠ чистий прибуток');

  // Правило incomeStatus: очікуване надходження є в русі коштів, але не в доході місяця.
  const view = buildDashboardView(s, SNAPSHOT_REF);
  const idx = view.monthKeys.indexOf(CURRENT_MONTH);
  assert.ok(idx >= 0);
  assert.ok(
    view.series.financeIn[idx] > st.monthIncome,
    'графік руху коштів ширший за звіт доходу (є incoming-запис)',
  );
});

test('головна: баланс і рахунки — view використовує чинний bankBalances', () => {
  const balances = bankBalances(fixture.transactions, fixture.financeSettings);
  const view = buildDashboardView(fixture, SNAPSHOT_REF);
  assert.deepEqual(view.balances, balances, 'view використовує чинний bankBalances');
  assert.ok(Object.prototype.hasOwnProperty.call(balances, 'mono'));
  assert.ok(balances.mono > 0);
  // Прихований запис (4000) не потрапив у баланс mono.
  assert.ok(balances.mono < 50000 + 2500 + 9999);
  const total = Object.values(balances).reduce((a, b) => a + b, 0);
  assert.ok(Number.isFinite(total));
  assert.equal(savingsSummary(fixture.savings, fixture.financeSettings).count, 3);
});
