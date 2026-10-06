import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, bootStore, makeTransaction } from './helpers';
import * as store from '@/lib/store';
import { summarizeTransactions } from '@/lib/calc';
import { buildExportPayload } from '@/lib/export';

test('пагінація не обрізає підсумки та експорт', async () => {
  clearAll();
  await bootStore();

  const all = Array.from({ length: 150 }, (_, i) => makeTransaction({
    amount: 100 + i,
    type: i % 2 === 0 ? 'income' : 'expense',
    date: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
  }));
  await store.saveCollection('transactions', all);

  const settings = store.getSnapshot().financeSettings;
  const full = store.getSnapshot().transactions;

  const visible = full.slice(0, 60);
  const summaryFull = summarizeTransactions(full, settings);
  const summaryVisible = summarizeTransactions(visible, settings);

  assert.equal(full.length, 150);
  assert.equal(visible.length, 60);
  assert.equal(summaryFull.count, 150);
  assert.equal(summaryVisible.count, 60);
  assert.notEqual(summaryFull.turnover, summaryVisible.turnover,
    'підсумок по повному набору має відрізнятися від видимої сторінки');

  const expectedTurnover = full
    .filter(t => !t.hidden && t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  assert.equal(Math.round(summaryFull.turnover), expectedTurnover);

  // Експорт не залежить від пагінації.
  const payload = buildExportPayload(store.getSnapshot());
  assert.equal(payload.data.transactions.length, 150);
});
