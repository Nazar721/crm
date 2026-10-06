import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, bootStore, makeClient, makeProject, makeTransaction } from './helpers';
import * as store from '@/lib/store';
import { dashboardStats, clientStats, getStatsContext, project } from '@/lib/calc';
import { createClient, saveProject, deleteProject, validateProjectInput } from '@/lib/actions';

test('після зміни даних статистика оновлюється', async () => {
  clearAll();
  await bootStore();

  const statsBefore = dashboardStats(store.getSnapshot());
  const created = await createClient({ name: 'Новий клієнт' });
  assert.equal(created.ok, true);

  const statsAfterClient = dashboardStats(store.getSnapshot());
  assert.equal(statsAfterClient.clientsCount, statsBefore.clientsCount + 1);

  const saved = await saveProject({
    name: 'Тестовий проєкт',
    type: 'IT',
    status: 'В роботі',
    startDate: '2026-03-01',
    clientName: 'Новий клієнт',
    budget: 100000,
    prepayment: 50000,
    myPercent: 40,
    fop: 10,
    partnerCommission: 0,
    currency: 'UAH',
  });
  assert.equal(saved.ok, true);

  const statsAfterProject = dashboardStats(store.getSnapshot());
  assert.equal(statsAfterProject.activeCount, 1);
  // Загальний бюджет рахується по завершених; борги — по всіх проєктах.
  assert.equal(statsAfterProject.totalBudget, 0);
  assert.ok(statsAfterProject.clientDebts > 0, 'борг клієнта з активного проєкту має зʼявитися');

  const ctx = getStatsContext(store.getSnapshot());
  const clientId = ctx.clients.find(c => c.name === 'Новий клієнт')!.id;
  assert.equal(clientStats(clientId, ctx).count, 1);

  const removed = await deleteProject((saved as { value: { id: string } }).value.id, false);
  assert.equal(removed.ok, true);
  const statsAfterDelete = dashboardStats(store.getSnapshot());
  assert.equal(statsAfterDelete.activeCount, 0);
});

test('індекси за ID: один snapshot — статистика по кожному клієнту без повторного читання', async () => {
  clearAll();
  await bootStore();
  const c1 = makeClient({ name: 'A' });
  const c2 = makeClient({ name: 'B' });
  await store.saveCollection('clients', [c1, c2]);
  await store.saveCollection('projectsActive', [
    makeProject({ clientId: c1.id }),
    makeProject({ clientId: c1.id }),
    makeProject({ clientId: c2.id }),
  ]);

  const snapshot = store.getSnapshot();
  const ctx = getStatsContext(snapshot);
  assert.equal(getStatsContext(snapshot), ctx, 'контекст кешується на snapshot');
  assert.equal(clientStats(c1.id, ctx).count, 2);
  assert.equal(clientStats(c2.id, ctx).count, 1);
  assert.equal(ctx.byClient.size, 2);
});

test('розрахунок проєкту лишається незмінним (наявні формули)', () => {
  const p = makeProject({ budget: 100000, prepayment: 40000, myPercent: 30, fop: 10, partnerCommission: 5, paidToSpecialist: 20000, profitTaken: 5000 });
  const c = project(p);
  assert.equal(c.fopAmount, 10000);
  assert.equal(c.partnerCommission, 5000);
  assert.equal(c.budgetAfterDeductions, 85000);
  assert.equal(c.projectProfit, 25500);
  assert.equal(c.specialistCost, 59500);
  assert.equal(c.clientDebt, 60000);
  assert.equal(c.specialistDebt, 39500);
  assert.equal(c.profitLeft, 20500);
});

test('валідація проєкту ловить недопустимі суми/відсотки/дати', () => {
  const base = makeProject();
  assert.equal(validateProjectInput(base).length, 0);

  const badPercent = validateProjectInput({ ...base, myPercent: 150 });
  assert.ok(badPercent.some(e => e.field === 'myPercent'));

  const badBudget = validateProjectInput({ ...base, budget: -10 });
  assert.ok(badBudget.some(e => e.field === 'budget'));

  const badDate = validateProjectInput({ ...base, startDate: '32.13.2026' });
  assert.ok(badDate.some(e => e.field === 'startDate'));

  const badType = validateProjectInput({ ...base, type: 'Незрозуміло' });
  assert.ok(badType.some(e => e.field === 'type'));
});

test('некоректна транзакція не зберігається', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('transactions', [makeTransaction()]);
  const { saveTransaction } = await import('@/lib/actions');

  const bad = await saveTransaction({ type: 'income', amount: -5, bank: 'mono' });
  assert.equal(bad.ok, false);
  assert.equal(store.getSnapshot().transactions.length, 1);

  const noBank = await saveTransaction({ type: 'income', amount: 10, bank: '' });
  assert.equal(noBank.ok, false);
  assert.equal(store.getSnapshot().transactions.length, 1);

  const okResult = await saveTransaction({ type: 'income', amount: 10, bank: 'mono', date: '2026-03-01' });
  assert.equal(okResult.ok, true);
  assert.equal(store.getSnapshot().transactions.length, 2);
});
