import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAll, bootStore, makeClient, makeProject, makeTransaction, FlakyDataSource,
} from './helpers';
import { LocalDataSource } from '@/lib/datasource/local';
import { applyImport } from '@/lib/importer';
import { EXPORT_FORMAT_ID, EXPORT_SCHEMA_VERSION, type ExportPayload } from '@/types';
import * as store from '@/lib/store';
import { getBackupRuntimeStatus, rotateBackups, markSnapshotDirty, isBackupSuppressed } from '@/lib/backup';
import { listAppliedMigrations } from '@/lib/migration-flags';

function payloadWith(clients: ReturnType<typeof makeClient>[], extra: Partial<ExportPayload> = {}): ExportPayload {
  return {
    app: EXPORT_FORMAT_ID,
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: '2026-05-01T08:00:00.000Z',
    data: {
      projectsActive: [],
      projectsCompleted: [],
      clients,
      specialists: [],
      partners: [],
      transactions: [],
      personalDebts: [],
      savings: [],
    },
    financeSettings: { usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
    ...extra,
  };
}

test('невдалий імпорт відновлює попередній стан і не вимикає резервування', async () => {
  clearAll();
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner, (kind, key, call) => kind === 'collection' && key === 'transactions' && call === 1);
  await bootStore(flaky);

  const original = makeClient({ name: 'Оригінальний' });
  await store.saveCollection('clients', [original]);
  await store.saveCollection('projectsActive', [makeProject({ clientId: original.id, clientName: original.name })]);
  const before = store.getSnapshot();

  const incoming = makeClient({ name: 'Імпортований' });
  const report = await applyImport(payloadWith([incoming]));

  assert.equal(report.ok, false);
  assert.equal(report.stage, 'write');
  assert.equal(report.recovered, true);

  const after = store.getSnapshot();
  assert.deepEqual(after.clients.map(c => c.name), ['Оригінальний']);
  assert.equal(after.projectsActive.length, 1);
  assert.equal(after.projectsActive[0].clientName, original.name);

  // Прапорець «резервування вимкнено» скинуто через finally після збою.
  assert.equal(isBackupSuppressed(), false, 'прапорець пригнічення backup має бути знято');

  // Резервування після збою імпорту працює далі.
  markSnapshotDirty();
  const rotation = rotateBackups(store.getSnapshot(), true);
  assert.equal(rotation.ok, true);
  assert.ok(localStorage.getItem('crm_backup_1'));
  assert.equal(getBackupRuntimeStatus().lastError, '');
});

test('якщо відновлення не вдалося — явний стан помилки + копія попереднього стану', async () => {
  clearAll();
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner, (kind, key, call) => {
    if (kind !== 'collection') return false;
    if (key === 'transactions' && call === 1) return true;
    if (key === 'projectsActive' && call >= 2) return true;
    return false;
  });
  await bootStore(flaky);

  const original = makeClient({ name: 'Оригінальний' });
  await store.saveCollection('clients', [original]);
  await store.saveCollection('projectsActive', [makeProject({ name: 'Оригінальний проєкт' })]);

  const report = await applyImport(payloadWith([makeClient({ name: 'Імпортований' })], {
    data: {
      projectsActive: [makeProject({ name: 'Імпортований проєкт' })],
      projectsCompleted: [],
      clients: [makeClient({ name: 'Імпортований' })],
      specialists: [],
      partners: [],
      transactions: [],
      personalDebts: [],
      savings: [],
    },
  } as Partial<ExportPayload>));

  assert.equal(report.ok, false);
  assert.equal(report.recovered, false);
  assert.ok(report.issue);

  const copy = localStorage.getItem('crm_import_previous');
  assert.ok(copy, 'копія попереднього стану має існувати');
  const parsed = JSON.parse(copy!) as { payload: ExportPayload };
  assert.equal(parsed.payload.data.clients[0].name, 'Оригінальний');
  assert.equal(parsed.payload.data.projectsActive[0].name, 'Оригінальний проєкт');
});

test('успішний імпорт записує дані, очищає прапорці міграцій і застосовує міграції', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [makeClient({ name: 'Старий' })]);
  localStorage.setItem('crm_migrated_v21', '1');

  const incoming = makeClient({ name: 'Новий' });
  const report = await applyImport(payloadWith([incoming]));
  assert.equal(report.ok, true);
  assert.equal(report.stage, 'done');

  const names = store.getSnapshot().clients.map(c => c.name);
  assert.deepEqual(names, ['Новий']);
  assert.equal(isBackupSuppressed(), false, 'прапорець пригнічення backup має бути знято');
  // Міграції перезапущені для імпортованих даних.
  assert.ok(listAppliedMigrations().includes('v21'));
});

test('імпорт зберігає displayCurrency, якщо у файлі його немає', async () => {
  clearAll();
  await bootStore();
  await store.saveSettings({
    usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'EUR',
  });

  const payload = payloadWith([makeClient()]);
  delete (payload as { financeSettings?: unknown }).financeSettings;
  const report = await applyImport(payload);
  assert.equal(report.ok, true);
  assert.equal(store.getSnapshot().financeSettings.displayCurrency, 'EUR');
});
