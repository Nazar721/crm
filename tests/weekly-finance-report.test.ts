import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySnapshot, makeTransaction } from './helpers';
import {
  formatWeekLabel,
  monthLabel,
  monthWeekSegments,
  requestedWeeklyReport,
  weeklyFinanceReply,
  weeklyFinanceReport,
  currentMonthKey,
} from '@/lib/weekly-finance-report';
import { incomeForMonth } from '@/lib/income-report';
import { monthIncome } from '@/lib/calc';
import { today } from '@/lib/utils';

function financeSettings() {
  return { usdRate: 40, eurRate: 50, usdtRate: 45, displayCurrency: 'UAH' as const };
}

test('відрізки жовтня 2026: понеділок–неділя, крайні неповні, підписи-діапазони', () => {
  const segs = monthWeekSegments(2026, 10);
  assert.deepEqual(segs.map(s => [s.start, s.end]), [
    ['2026-10-01', '2026-10-04'],
    ['2026-10-05', '2026-10-11'],
    ['2026-10-12', '2026-10-18'],
    ['2026-10-19', '2026-10-25'],
    ['2026-10-26', '2026-10-31'],
  ]);
  assert.deepEqual(segs.map(s => s.label), ['1–4 жовт.', '5–11 жовт.', '12–18 жовт.', '19–25 жовт.', '26–31 жовт.']);
  assert.equal(formatWeekLabel(1, 4, 10), '1–4 жовт.');
  assert.equal(monthLabel('2026-10'), 'жовтень 2026');
});

test('перехід року: січень 2026 починається в четвер, перший тиждень неповний', () => {
  const segs = monthWeekSegments(2026, 1);
  assert.equal(segs[0].start, '2026-01-01');
  assert.equal(segs[0].end, '2026-01-04');
  assert.equal(segs[0].label, '1–4 січ.');
  for (let i = 1; i < segs.length; i++) {
    assert.ok(segs[i].start > segs[i - 1].end, 'відрізки не перетинаються');
  }
  assert.equal(segs[segs.length - 1].end, '2026-01-31');
});

test('лютий високосного 2024: 29 днів, останній відрізок 26–29', () => {
  const segs = monthWeekSegments(2024, 2);
  assert.equal(segs.length, 5);
  assert.deepEqual([segs[0].start, segs[0].end], ['2024-02-01', '2024-02-04']);
  assert.deepEqual([segs[4].start, segs[4].end], ['2024-02-26', '2024-02-29']);
});

test('лютий звичайного 2026: 28 днів, починається в неділю — 5 відрізків', () => {
  const segs = monthWeekSegments(2026, 2);
  assert.equal(segs.length, 5);
  assert.deepEqual([segs[0].start, segs[0].end], ['2026-02-01', '2026-02-01']);
  assert.equal(segs[4].end, '2026-02-28');
});

test('некоректний місяць відхиляється', () => {
  assert.throws(() => monthWeekSegments(2026, 13), /Некоректний місяць/);
  assert.throws(() => weeklyFinanceReport([], '2026-13', financeSettings()), /Некоректний місяць/);
});


test('розподіл транзакцій: кожна рівно в одному тижні, тижні без транзакцій показуються', () => {
  const s = financeSettings();
  const r = weeklyFinanceReport([
    makeTransaction({ amount: 1000, date: '2026-10-01' }),
    makeTransaction({ amount: 500, date: '2026-10-04' }),
    makeTransaction({ amount: 2000, date: '2026-10-05' }),
    makeTransaction({ amount: 700, date: '2026-10-31' }),
    makeTransaction({ amount: 300, date: '2026-10-15', type: 'expense' }),
    makeTransaction({ amount: 999, date: '2026-09-30' }),
    makeTransaction({ amount: 888, date: '2026-11-01' }),
  ], '2026-10', s);
  assert.equal(r.weeks.length, 5);
  assert.equal(r.weeks[0].income, 1500);
  assert.equal(r.weeks[1].income, 2000);
  assert.equal(r.weeks[2].income, 0);
  assert.equal(r.weeks[2].expense, 300);
  assert.equal(r.weeks[4].income, 700);
  assert.equal(r.totalIncome, 4200);
  assert.equal(r.totalExpense, 300);
  assert.equal(r.weeks.reduce((a, w) => a + w.income, 0), r.totalIncome);
  assert.equal(r.weeks.reduce((a, w) => a + w.expense, 0), r.totalExpense);
  assert.equal(r.currency, 'UAH');
  assert.equal(r.year, 2026);
  assert.equal(r.month, 10);
});

test('виключені записи: приховані, incoming, project_*, перекази; різні валюти', () => {
  const s = financeSettings();
  const r = weeklyFinanceReport([
    makeTransaction({ amount: 1000, date: '2026-10-10' }),
    makeTransaction({ amount: 100, bank: 'cash_usd', date: '2026-10-10' }),
    makeTransaction({ amount: 99, date: '2026-10-10', hidden: true }),
    makeTransaction({ amount: 500, date: '2026-10-10', incomeStatus: 'incoming' }),
    makeTransaction({ amount: 777, date: '2026-10-10', source: 'project_generated' }),
    makeTransaction({ amount: 50, date: '2026-10-10', type: 'expense' }),
    makeTransaction({ amount: 1000, date: '2026-10-10', type: 'transfer', toBank: 'cash' }),
    makeTransaction({ amount: 60, bank: 'cash_usd', date: '2026-10-11', type: 'expense' }),
  ], '2026-10', s);
  // 1000 UAH + 100 USD × 40 = 5000; витрати 50 UAH + 60 USD × 40 = 2450
  assert.equal(r.totalIncome, 5000);
  assert.equal(r.totalExpense, 2450);
});

test('сума тижнів дорівнює місячним підсумкам monthIncome і financeExpenses', () => {
  const snap = emptySnapshot();
  snap.financeSettings = financeSettings();
  snap.transactions = [
    makeTransaction({ amount: 1000, date: '2026-07-10' }),
    makeTransaction({ amount: 100, bank: 'cash_usd', date: '2026-07-10' }),
    makeTransaction({ amount: 99, date: '2026-07-10', hidden: true }),
    makeTransaction({ amount: 500, date: '2026-07-10', incomeStatus: 'incoming' }),
    makeTransaction({ amount: 777, date: '2026-07-10', source: 'project_generated' }),
    makeTransaction({ amount: 50, date: '2026-07-10', type: 'expense' }),
    makeTransaction({ amount: 1000, date: '2026-08-10' }),
  ];
  const r = weeklyFinanceReport(snap.transactions, '2026-07', snap.financeSettings);
  const monthly = incomeForMonth(snap, '2026-07');
  assert.equal(r.totalIncome, monthIncome(snap.transactions, '2026-07', snap.financeSettings));
  assert.equal(r.totalIncome, monthly.financeIncome);
  assert.equal(r.totalExpense, monthly.financeExpenses);
  assert.equal(r.totalIncome, 5000);
  assert.equal(r.totalExpense, 50);
});

test('дати без часу не зміщуються: крайні дні місяця лишаються у своїх тижнях', () => {
  const r = weeklyFinanceReport([
    makeTransaction({ amount: 10, date: '2026-10-01' }),
    makeTransaction({ amount: 20, date: '2026-10-31' }),
  ], '2026-10', financeSettings());
  assert.equal(r.weeks[0].income, 10);
  assert.equal(r.weeks[r.weeks.length - 1].income, 20);
  assert.equal(r.totalIncome, 30);
});

test('розпізнавання: доходи по тижнях за жовтень з роком', () => {
  const q = requestedWeeklyReport('Покажи доходи по тижнях за жовтень 2026', []);
  assert.deepEqual(q, { month: '2026-10', metric: 'income', focus: 'table' });
});

test('розпізнавання: витрати другого тижня липня', () => {
  const q = requestedWeeklyReport('Скільки витратив другого тижня липня 2026?', []);
  assert.deepEqual(q, { month: '2026-07', metric: 'expense', weekIndex: 1, focus: 'single' });
});

test('розпізнавання: порівняння і найприбутковіший тиждень', () => {
  const cmp = requestedWeeklyReport('Порівняй доходи й витрати за кожен тиждень жовтня 2026', []);
  assert.deepEqual(cmp, { month: '2026-10', metric: 'both', focus: 'table' });
  const best = requestedWeeklyReport('Який тиждень був найприбутковішим у жовтні 2026?', []);
  assert.deepEqual(best, { month: '2026-10', metric: 'both', focus: 'best' });
});

test('розпізнавання: продовження «цей самий місяць» зберігає період', () => {
  const history = [{ role: 'user', text: 'Покажи доходи по тижнях за жовтень 2026' }];
  const q = requestedWeeklyReport('А тепер витрати за цей самий місяць', history);
  assert.deepEqual(q, { month: '2026-10', metric: 'expense', focus: 'table' });
});

test('розпізнавання: коротке «та» повторює попередній тижневий запит', () => {
  const history = [{ role: 'user', text: 'Покажи доходи по тижнях за липень 2026' }];
  const q = requestedWeeklyReport('та', history);
  assert.deepEqual(q, { month: '2026-07', metric: 'income', focus: 'table' });
});

test('розпізнавання: без місяця і без історії — null, команди змін не перехоплюються', () => {
  assert.equal(requestedWeeklyReport('Покажи доходи по тижнях', []), null);
  const history = [{ role: 'user', text: 'Покажи доходи по тижнях за липень 2026' }];
  assert.equal(requestedWeeklyReport('створи дохід за липень', history), null);
  assert.equal(requestedWeeklyReport('привіт', history), null);
  assert.equal(requestedWeeklyReport('дохід за рік по тижнях', history), null);
});


test('відповідь: таблиця Тиждень|Дати|Доходи|Витрати|Різниця з джерелом і без «чистого прибутку»', () => {
  const snap = emptySnapshot();
  snap.financeSettings = financeSettings();
  snap.transactions = [
    makeTransaction({ amount: 1500, date: '2026-10-02' }),
    makeTransaction({ amount: 2000, date: '2026-10-06' }),
    makeTransaction({ amount: 300, date: '2026-10-15', type: 'expense' }),
  ];
  const text = weeklyFinanceReply(snap, { month: '2026-10', metric: 'both', focus: 'table' }).text;
  assert.ok(text.includes('| Тиждень | Дати | Доходи | Витрати | Різниця |'));
  assert.ok(text.includes('2026-10-01…2026-10-04'));
  assert.ok(text.includes('Джерело: Фінанси — транзакції.'));
  assert.ok(text.includes('«Доходи мінус витрати»'));
  assert.ok(!/чистий прибуток (агенції|агентства)/i.test(text.replace(/а не [«"]?чистий прибуток/gi, '')));
});

test('відповідь: окремий тиждень і найприбутковіший називають номер і дати', () => {
  const snap = emptySnapshot();
  snap.financeSettings = financeSettings();
  snap.transactions = [
    makeTransaction({ amount: 1500, date: '2026-10-02' }),
    makeTransaction({ amount: 2000, date: '2026-10-06' }),
    makeTransaction({ amount: 300, date: '2026-10-15', type: 'expense' }),
  ];
  const single = weeklyFinanceReply(snap, { month: '2026-10', metric: 'expense', weekIndex: 1, focus: 'single' }).text;
  assert.ok(single.includes('Тиждень №2 (2026-10-05…2026-10-11'));
  const best = weeklyFinanceReply(snap, { month: '2026-10', metric: 'both', focus: 'best' }).text;
  assert.ok(best.includes('Найприбутковіший — тиждень №2 (2026-10-05…2026-10-11'));
});

test('відповідь: порожній місяць і позамежний тиждень', () => {
  const snap = emptySnapshot();
  snap.financeSettings = financeSettings();
  const empty = weeklyFinanceReply(snap, { month: '2026-10', metric: 'income', focus: 'table' }).text;
  assert.ok(empty.includes('Транзакцій за цей місяць немає.'));
  const out = weeklyFinanceReply(snap, { month: '2026-10', metric: 'income', weekIndex: 9, focus: 'single' }).text;
  assert.ok(out.includes('лише 5 тижні'));
});

test('відповідь: ті самі числа, що й у графіка (weeklyFinanceReport)', () => {
  const snap = emptySnapshot();
  snap.financeSettings = financeSettings();
  snap.transactions = [makeTransaction({ amount: 1234, date: '2026-10-20' })];
  const r = weeklyFinanceReport(snap.transactions, '2026-10', snap.financeSettings);
  assert.equal(r.weeks[3].income, 1234);
  const text = weeklyFinanceReply(snap, { month: '2026-10', metric: 'income', focus: 'table' }).text;
  assert.ok(text.includes(new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(1234)));
});

test('currentMonthKey збігається з обліковим «сьогодні» Europe/Kyiv', () => {
  assert.equal(currentMonthKey(), today().slice(0, 7));
});
