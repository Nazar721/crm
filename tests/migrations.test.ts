import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, bootStore, makeProject, makeClient } from './helpers';
import * as store from '@/lib/store';
import { migrate, MIGRATIONS } from '@/lib/migrations';
import { listAppliedMigrations, isMigrationApplied } from '@/lib/migration-flags';

test('міграції виконуються один раз на версію', async () => {
  clearAll();
  await bootStore();

  const first = await migrate();
  assert.ok(first.applied.length > 0, 'перший запуск має застосувати міграції');
  assert.ok(first.applied.every(id => isMigrationApplied(id)));

  const second = await migrate();
  assert.equal(second.applied.length, 0, 'повторний запуск нічого не застосовує');
  assert.ok(second.skipped.length === MIGRATIONS.length);
});

test('повторна міграція не переписує дані', async () => {
  clearAll();
  await bootStore();
  await migrate();

  const project = makeProject({ name: 'Проєкт з ручними полями', myPercent: 33, profitTaken: 1234, description: 'залишити' });
  await store.saveCollection('projectsActive', [project]);
  const snapshotAfterWrite = JSON.stringify(store.getSnapshot().projectsActive);

  const report = await migrate();
  assert.equal(report.applied.length, 0);
  assert.equal(JSON.stringify(store.getSnapshot().projectsActive), snapshotAfterWrite);
});

test('безумовне переписування проєктів/партнерів/фахівців прибрано', async () => {
  clearAll();
  await bootStore();

  // Імітуємо «старий» проєкт із обчисленими полями, якщо bерсія вже застосована.
  localStorage.setItem('crm_migrated_v21', '1');
  localStorage.setItem('crm_migrated_v11', '1');
  const project = makeProject({ name: 'Не чіпати' }) as unknown as Record<string, unknown>;
  project.myIncome = 555;
  project.clientDebt = 111;
  await store.saveCollection('projectsActive', [project as never]);

  const partner = {
    id: 'pt1', name: 'Партнер', currency: 'UAH',
    givenProjectsCount: 3, givenProjectsPrice: 1000, ourCommission: 500, paidToUs: 250,
  };
  await store.saveCollection('partners', [partner as never]);

  const specialists = [{ id: 'sp1', name: 'Фахівець', paidToSpecialist: 999, debt: 42 } as never];
  await store.saveCollection('specialists', specialists);

  const report = await migrate();
  assert.equal(report.applied.includes('v21'), false, 'v21 уже застосована');
  assert.equal(report.applied.includes('v11'), false, 'v11 уже застосована');

  const projects = store.getSnapshot().projectsActive as unknown as Record<string, unknown>[];
  assert.equal(projects[0].myIncome, 555, 'обчислене поле не видалено без повторної міграції');
  assert.equal(projects[0].clientDebt, 111);

  const partners = store.getSnapshot().partners as unknown as Record<string, unknown>[];
  assert.equal(partners[0].givenProjectsCount, 3);

  const spec = store.getSnapshot().specialists[0] as unknown as Record<string, unknown>;
  assert.equal(spec.paidToSpecialist, 999);
});

test('на свіжому сховищі міграції нормалізують дані рівно один раз', async () => {
  clearAll();
  await bootStore();
  const project = makeProject() as unknown as Record<string, unknown>;
  project.myIncome = 777;
  await store.saveCollection('projectsActive', [project as never]);
  await store.saveCollection('clients', [makeClient()]);

  await migrate();
  const firstRun = store.getSnapshot().projectsActive as unknown as Record<string, unknown>[];
  assert.equal(firstRun[0].myIncome, undefined, 'обчислене поле прибрано при першій міграції');
  assert.ok(listAppliedMigrations().length > 0);

  const jsonBefore = JSON.stringify(store.getSnapshot().projectsActive);
  await migrate();
  assert.equal(JSON.stringify(store.getSnapshot().projectsActive), jsonBefore);
});
