import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, bootStore, makeClient, makeProject, makeTransaction } from './helpers';
import { validateBackup } from '@/lib/validate-backup';
import { applyImport, previewImport } from '@/lib/importer';
import { EXPORT_FORMAT_ID, EXPORT_SCHEMA_VERSION, type ExportPayload } from '@/types';
import * as store from '@/lib/store';

function payload(overrides: Partial<Record<string, unknown>> = {}): ExportPayload {
  return {
    app: EXPORT_FORMAT_ID,
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: '2026-04-01T12:00:00.000Z',
    data: {
      projectsActive: [makeProject({ clientId: 'cli_x' })],
      projectsCompleted: [],
      clients: [makeClient({ id: 'cli_x' })],
      specialists: [],
      partners: [],
      transactions: [makeTransaction()],
      personalDebts: [],
      savings: [],
    },
    financeSettings: { usdRate: 40, eurRate: 45, usdtRate: 40, displayCurrency: 'UAH' },
    ...overrides,
  } as ExportPayload;
}

test('невідомий JSON відхиляється до будь-якого запису', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [makeClient()]);
  const before = store.getSnapshot().clients.length;

  const result = await applyImport({ foo: 'bar', nested: { a: 1 } });
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'validate');
  assert.equal(store.getSnapshot().clients.length, before);

  const arr = await applyImport([1, 2, 3]);
  assert.equal(arr.ok, false);
  assert.equal(store.getSnapshot().clients.length, before);
});

test('відсутня обов’язкова колекція / завелика версія → відмова', () => {
  const broken = payload() as unknown as Record<string, unknown>;
  delete (broken.data as Record<string, unknown>).savings;
  const v1 = validateBackup(broken);
  assert.equal(v1.ok, false);
  assert.ok(v1.errors.some(e => e.message.includes('savings')));

  const future = payload({ version: EXPORT_SCHEMA_VERSION + 5 });
  const v2 = validateBackup(future);
  assert.equal(v2.ok, false);
  assert.ok(v2.errors.some(e => e.message.includes('версію')));
});

test('старий (legacy-flat) формат підтримується явно і окремо', () => {
  const legacy = {
    projectsActive: [],
    projectsCompleted: [],
    clients: [makeClient()],
    specialists: [],
    partners: [],
    transactions: [],
    personalDebts: [],
    savings: [],
  };
  const result = validateBackup(legacy);
  assert.equal(result.ok, true);
  assert.equal(result.format, 'legacy-flat');
  assert.equal(result.version, 0);
  assert.ok(result.warnings.some(w => w.message.includes('legacy-flat')));

  const almostLegacy = { clients: [makeClient()], transactions: [] };
  assert.equal(validateBackup(almostLegacy).ok, false);
});

test('невалідні записи пропускаються з явною помилкою, валідні зберігаються', () => {
  const data = payload();
  (data.data.clients as unknown[]).push({ name: 'Без ID' });
  (data.data.transactions as unknown[]).push({ id: 't1', type: 'weird', bank: 'mono', amount: 10 });
  (data.data.transactions as unknown[]).push({ id: 't2', type: 'income', bank: 'mono', amount: -5 });

  const result = validateBackup(data);
  assert.equal(result.ok, true);
  assert.equal(result.counts.clients, 1);
  assert.equal(result.skipped.clients, 1);
  assert.equal(result.counts.transactions, 1);
  assert.equal(result.skipped.transactions, 2);
  assert.ok(result.recordIssues.length >= 3);
});

test('биті зв’язки очищуються з попередженням', () => {
  const data = payload();
  (data.data.projectsActive[0] as { clientId: string }).clientId = 'missing_client';
  const result = validateBackup(data);
  assert.equal(result.ok, true);
  assert.equal((result.content!.projectsActive[0] as { clientId: string }).clientId, '');
  assert.ok(result.warnings.some(w => w.message.includes('невідомого клієнта')));
});

test('previewImport нічого не пише', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [makeClient()]);
  const before = store.getSnapshot();

  const preview = previewImport(payload());
  assert.equal(preview.validation.ok, true);
  assert.equal(preview.previousTotal, 1);
  assert.equal(store.getSnapshot(), before);
});
