import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, bootStore, makeTransaction } from './helpers';
import * as store from '@/lib/store';
import { saveRates, setDisplayCurrency } from '@/lib/actions';
import { financeBalance, bankBalances, monthIncome, summarizeTransactions, toDisplay } from '@/lib/calc';
import { getSettings } from '@/lib/settings';

test('збереження курсів не скидає displayCurrency', async () => {
  clearAll();
  await bootStore();
  await setDisplayCurrency('USD');
  assert.equal(store.getSnapshot().financeSettings.displayCurrency, 'USD');

  const result = await saveRates({ usdRate: '42.5', eurRate: 46, usdtRate: 42.5 });
  assert.equal(result.ok, true);

  const settings = store.getSnapshot().financeSettings;
  assert.equal(settings.displayCurrency, 'USD', 'displayCurrency має зберегтися');
  assert.equal(settings.usdRate, 42.5);
  assert.equal(settings.eurRate, 46);
  assert.equal(getSettings().displayCurrency, 'USD', 'кеш налаштувань оновлено');
});

test('зміна курсів інвалідовує залежні підсумки', async () => {
  clearAll();
  await bootStore();
  await setDisplayCurrency('UAH');
  await store.saveCollection('transactions', [
    makeTransaction({ type: 'income', amount: 100, bank: 'cash_usd' }),
  ]);
  await saveRates({ usdRate: 40, eurRate: 44, usdtRate: 40 });

  const before = financeBalance(store.getSnapshot().transactions, store.getSnapshot().financeSettings);
  await saveRates({ usdRate: 50, eurRate: 44, usdtRate: 50 });
  const after = financeBalance(store.getSnapshot().transactions, store.getSnapshot().financeSettings);

  assert.notEqual(before, after);
  assert.equal(after, 100 * 50);
});

test('приховані записи виключаються з балансу, місячного доходу й підсумків', async () => {
  clearAll();
  await bootStore();
  await setDisplayCurrency('UAH');
  await store.saveCollection('transactions', [
    makeTransaction({ amount: 1000, date: '2026-03-05' }),
    makeTransaction({ amount: 500, date: '2026-03-06', hidden: true }),
    makeTransaction({ type: 'expense', amount: 300, date: '2026-03-07' }),
  ]);

  const txs = store.getSnapshot().transactions;
  const balances = bankBalances(txs, store.getSnapshot().financeSettings);
  assert.equal(balances.mono, 700, 'hidden не враховується у балансі');

  const balance = financeBalance(txs, store.getSnapshot().financeSettings);
  assert.equal(balance, 700);

  const income = monthIncome(txs, '2026-03', store.getSnapshot().financeSettings);
  assert.equal(income, 1000);

  const summary = summarizeTransactions(txs, store.getSnapshot().financeSettings);
  assert.equal(summary.count, 2);
  assert.equal(summary.turnover, 1000);
  assert.equal(summary.expense, 300);
});

test('hidden не зникає з повного експорту', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('transactions', [
    makeTransaction({ amount: 100 }),
    makeTransaction({ amount: 200, hidden: true }),
  ]);
  const { buildExportPayload } = await import('@/lib/export');
  const payload = buildExportPayload(store.getSnapshot());
  assert.equal(payload.data.transactions.length, 2);
  assert.equal(payload.data.transactions.filter(t => t.hidden).length, 1);
});

test('toDisplay використовує актуальні курси після зміни', async () => {
  clearAll();
  await bootStore();
  await saveRates({ usdRate: 40, eurRate: 44, usdtRate: 40 });
  assert.equal(toDisplay(100, 'USD', getSettings()), 4000);
  await saveRates({ usdRate: 50, eurRate: 44, usdtRate: 50 });
  assert.equal(toDisplay(100, 'USD', getSettings()), 5000);
});
