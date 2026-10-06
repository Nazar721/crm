import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAll, bootStore, makeClient, makeProject, makeTransaction,
  FlakyDataSource, snapshotFingerprint,
} from './helpers';
import { LocalDataSource } from '@/lib/datasource/local';
import * as store from '@/lib/store';
import { applyImport, previewImport } from '@/lib/importer';
import { migrate, runMigrations, MIGRATIONS } from '@/lib/migrations';
import { isMigrationApplied, listAppliedMigrations } from '@/lib/migration-flags';
import { validateBackup } from '@/lib/validate-backup';
import { getBackupRuntimeStatus, resetBackupRuntime, rotateBackups, markSnapshotDirty, isBackupSuppressed } from '@/lib/backup';
import { buildExportPayload } from '@/lib/export';
import { EXPORT_FORMAT_ID, EXPORT_SCHEMA_VERSION, type ExportPayload } from '@/types';

function payloadWith(clients: ReturnType<typeof makeClient>[], overrides: Partial<ExportPayload> = {}): ExportPayload {
  return {
    app: EXPORT_FORMAT_ID,
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: '2026-10-01T08:00:00.000Z',
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
    ...overrides,
  };
}

// ------------------------------------------------------------
// 1. Невдала міграція
// ------------------------------------------------------------

test('невдала міграція НЕ позначається виконаною і блокує редагування', async () => {
  clearAll();
  const inner = new LocalDataSource();
  let failSpecialists = true;
  const flaky = new FlakyDataSource(inner, (kind, key) => kind === 'collection' && key === 'specialists' && failSpecialists);
  await bootStore(flaky);

  // Саме migrate() (без обгортки) має виставляти блок — як у репродукції огляду.
  const report = await migrate();
  assert.ok(report.failed.includes('v11'), `failed: ${report.failed.join(',')}`);
  assert.equal(report.applied.includes('v11'), false, 'прапорець не має ставитися');
  assert.equal(isMigrationApplied('v11'), false, 'прапорець у сховищі не має існувати');
  assert.ok(report.failed.length < MIGRATIONS.length, 'ланцюжок зупинено, не всі міграції «виконані»');
  assert.equal(report.applied.length, 0);

  // Редагування заблоковано, допоки міграція не виконається.
  assert.ok(store.getWriteBlock());
  const blocked = await store.saveCollection('clients', [makeClient()]);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.ok(blocked.issue.message.includes('Міграції не застосовано'));

  // Повторний запуск після «виправлення» — міграція таки виконується.
  failSpecialists = false;
  const retry = await migrate();
  assert.equal(retry.failed.length, 0);
  assert.ok(retry.applied.includes('v11'));
  assert.equal(isMigrationApplied('v11'), true);
  assert.equal(store.getWriteBlock(), null);

  const ok = await store.saveCollection('clients', [makeClient()]);
  assert.equal(ok.ok, true);
});

// ------------------------------------------------------------
// 2. Збій налаштувань під час імпорту
// ------------------------------------------------------------

test('збій запису налаштувань: відновлюється ВСЕ — колекції, налаштування, прапорці', async () => {
  clearAll();
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner, (kind, key, call) =>
    kind === 'settings' && key === 'financeSettings' && call === 2);
  await bootStore(flaky);

  await runMigrations();
  await store.saveSettings({ usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'EUR' });
  await store.saveCollection('clients', [makeClient({ name: 'ORIGINAL' })]);
  await store.saveCollection('projectsActive', [makeProject({ name: 'Оригінальний проєкт' })]);

  const beforeData = snapshotFingerprint();
  const beforeFlags = listAppliedMigrations();
  assert.ok(beforeFlags.length > 0);

  const report = await applyImport(payloadWith([makeClient({ name: 'IMPORTED' })]));

  assert.equal(report.ok, false);
  assert.equal(report.stage, 'settings');
  assert.equal(report.recovered, true, 'стан має бути відновлено');
  assert.equal(isBackupSuppressed(), false, 'пригнічення backup знято через finally');

  // Повна звірка стану, а не лише текст помилки.
  assert.equal(snapshotFingerprint(), beforeData, 'усі колекції і налаштування як до імпорту');
  assert.deepEqual(listAppliedMigrations().slice().sort(), beforeFlags.slice().sort(), 'прапорці міграцій відновлено');
  assert.equal(store.getSnapshot().financeSettings.displayCurrency, 'EUR');
  assert.deepEqual(store.getSnapshot().clients.map(c => c.name), ['ORIGINAL']);
  assert.equal(store.getWriteBlock(), null, 'після успішного відновлення блоку немає');
});

// ------------------------------------------------------------
// 3. Збій фіналізації (міграції) після запису колекцій
// ------------------------------------------------------------

test('збій фіналізації після запису колекцій: відновлення колекцій, налаштувань і прапорців', async () => {
  clearAll();
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner);
  await bootStore(flaky);

  await runMigrations();
  await store.saveSettings({ usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'USD' });
  await store.saveCollection('clients', [makeClient({ name: 'ORIGINAL' })]);
  await store.saveCollection('projectsActive', [makeProject({ name: 'Оригінальний проєкт' })]);

  const beforeData = snapshotFingerprint();
  const beforeFlags = listAppliedMigrations().slice().sort();
  assert.ok(beforeFlags.includes('v21'));

  // Імпорт спочатку пише 8 колекцій (specialists — 4-та), а перший запис
  // міграцій (v11 → specialists) іде після цього. Ламаємо саме його.
  const base = flaky.collectionCalls;
  flaky.failNextOn(['specialists'], base + 5);

  const report = await applyImport(payloadWith([makeClient({ name: 'IMPORTED' })]));

  assert.equal(report.ok, false);
  assert.equal(report.stage, 'finalize');
  assert.equal(report.recovered, true, 'відновлення має вдатися');
  assert.ok(report.issue!.includes('Міграції не застосовано'));
  assert.equal(isBackupSuppressed(), false);

  assert.equal(snapshotFingerprint(), beforeData, 'усі колекції і налаштування як до імпорту');
  assert.deepEqual(listAppliedMigrations().slice().sort(), beforeFlags, 'прапорці відновлено до попереднього стану');
  assert.equal(store.getSnapshot().clients[0].name, 'ORIGINAL');
  assert.equal(store.getSnapshot().projectsActive[0].name, 'Оригінальний проєкт');
  assert.equal(store.getWriteBlock(), null);
});

test('невдала міграція під час імпорту залишає явний блок, якщо відновити не вдалося', async () => {
  clearAll();
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner);
  await bootStore(flaky);
  await runMigrations();
  await store.saveCollection('clients', [makeClient({ name: 'ORIGINAL' })]);

  const base = flaky.collectionCalls;
  // Ламаємо і фіналізацію (v11 пише specialists після 8 колекцій імпорту),
  // і подальше відновлення: той самий specialists у restore теж відмовить.
  flaky.shouldFail = (kind, key) =>
    kind === 'collection' && key === 'specialists' && flaky.collectionCalls > base + 8;

  const report = await applyImport(payloadWith([makeClient({ name: 'IMPORTED' })]));
  assert.equal(report.ok, false);
  assert.equal(report.recovered, false, 'відновлення невдале — це має бути видно');
  assert.ok(report.restoreSkipped !== undefined);
  assert.ok(store.getWriteBlock(), 'після невідновленого збою запис має бути заблоковано');
  assert.ok(store.getWriteBlock()!.includes('Не вдалося відновити'));
});

// ------------------------------------------------------------
// 4. Пошкоджена колекція не перезаписується міграціями
// ------------------------------------------------------------

test('міграції не перезаписують пошкоджену колекцію порожнім масивом', async () => {
  clearAll();
  localStorage.setItem('projects_active', '{broken');
  await bootStore();

  const report = await runMigrations();
  assert.ok(report.failed.length > 0, 'міграція, що чіпає колекцію, має зазнати відмови');
  assert.equal(report.failed[0], 'v21', `перша невдала: ${report.failed.join(',')}`);
  assert.equal(localStorage.getItem('projects_active'), '{broken',
    'оригінальний вміст НЕ має бути перезаписаний');
  assert.ok(store.getCorruptCollections().includes('projectsActive'));
  assert.equal(isMigrationApplied('v21'), false, 'прапорець не ставлено');

  // Звичайний запис теж заблоковано.
  const blocked = await store.saveCollection('projectsActive', []);
  assert.equal(blocked.ok, false);

  // Явне відновлення через імпорт (import scope) розблоковує колекцію.
  const recovery = await applyImport(payloadWith([makeClient({ name: 'Відновлено' })], {
    data: {
      projectsActive: [makeProject({ name: 'Відновлений проєкт' })],
      projectsCompleted: [],
      clients: [makeClient({ name: 'Відновлено' })],
      specialists: [],
      partners: [],
      transactions: [],
      personalDebts: [],
      savings: [],
    },
  } as Partial<ExportPayload>));
  assert.equal(recovery.ok, true, `імпорт мав вдатися: ${recovery.issue}`);
  assert.equal(localStorage.getItem('projects_active')!.includes('Відновлений проєкт'), true);
  assert.equal(store.isCollectionCorrupt('projectsActive'), false);
  assert.equal(store.getWriteBlock(), null);
});

test('непридатний карантин: повідомлення не бреше про збереження оригіналу', async () => {
  clearAll();
  const originalSet = localStorage.setItem.bind(localStorage);
  (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = (k: string, v: string) => {
    if (String(k).startsWith('crm_corrupt_')) {
      const err = new Error('quota') as Error & { name: string };
      err.name = 'QuotaExceededError';
      throw err;
    }
    originalSet(k, v);
  };
  try {
    localStorage.setItem('savings', '{broken-json');
    await bootStore();

    const issues = store.getIssues().filter(i => i.kind === 'corrupt_json');
    assert.equal(issues.length, 1);
    assert.equal(issues[0].preservedAt, undefined, 'немає неправдивого посилання на копію');
    assert.ok(issues[0].message.includes('зберегти не вдалося'), issues[0].message);
    assert.ok(!issues[0].message.includes('Оригінал збережено окремо'), issues[0].message);

    // Запис у пошкоджену колекцію все одно заблоковано.
    const blocked = await store.saveCollection('savings', []);
    assert.equal(blocked.ok, false);
  } finally {
    (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = originalSet;
  }
});

// ------------------------------------------------------------
// 5. Заповнене localStorage: читання та експорт доступні
// ------------------------------------------------------------

test('заповнене сховище не блокує читання та експорт, лише запис', async () => {
  clearAll();
  const originalSet = localStorage.setItem.bind(localStorage);
  originalSet('clients', JSON.stringify([makeClient({ name: 'Читабельний' })]));
  originalSet('projects_active', JSON.stringify([makeProject({ name: 'Читабельний проєкт' })]));

  (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = () => {
    const err = new Error('quota') as Error & { name: string };
    err.name = 'QuotaExceededError';
    throw err;
  };

  try {
    await bootStore();

    assert.equal(store.getStoreStatus(), 'ready', 'читання має працювати');
    assert.equal(store.getSnapshot().clients.length, 1);
    assert.equal(store.getSnapshot().projectsActive.length, 1);
    assert.ok(store.getWriteBlock());
    assert.ok(store.getWriteBlock()!.includes('Перевищено ліміт'), store.getWriteBlock()!);

    // Запис користувача заблоковано з поясненням.
    const blocked = await store.saveCollection('clients', []);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.ok(blocked.issue.message.includes('Перевищено ліміт'));

    // Експорт доступних даних працює.
    const payload = buildExportPayload(store.getSnapshot());
    assert.equal(payload.data.clients.length, 1);
    assert.equal(payload.data.projectsActive.length, 1);
    assert.equal(payload.data.clients[0].name, 'Читабельний');
  } finally {
    (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = originalSet;
  }
});

test('експорт додає проблеми сховища і лишається валідним для повторного імпорту', async () => {
  clearAll();
  localStorage.setItem('savings', '{broken');
  await bootStore();

  const { exportData } = await import('@/lib/storage');
  const payload = exportData();

  assert.ok(payload.issues && payload.issues.length >= 1, 'проблеми мають потрапити у файл');
  assert.ok(payload.issues!.some(i => i.collection === 'savings' && i.kind === 'corrupt_json'));
  assert.equal(payload.data.savings.length, 0);

  // Поле issues не ламає повторну валідацію/імпорт.
  const round = validateBackup(JSON.parse(JSON.stringify(payload)));
  assert.equal(round.ok, true, JSON.stringify(round.errors));
});

// ------------------------------------------------------------
// 6. Дублікати ID
// ------------------------------------------------------------

test('дублікати ID всередині колекції блокують імпорт', async () => {
  const duplicate = payloadWith([
    makeClient({ id: 'same_id', name: 'Перший' }),
    makeClient({ id: 'same_id', name: 'Другий' }),
  ]);

  const result = validateBackup(duplicate);
  assert.equal(result.ok, false, 'імпорт має бути відхилено');
  assert.ok(result.errors.some(e => e.message.includes('дублікат id «same_id»')), JSON.stringify(result.errors));
  assert.ok(result.errors.some(e => e.message.includes('індекс')), 'потрібна точна адреса конфлікту');

  clearAll();
  await bootStore();
  const before = snapshotFingerprint();
  const applied = await applyImport(duplicate);
  assert.equal(applied.ok, false);
  assert.equal(applied.stage, 'validate');
  assert.equal(snapshotFingerprint(), before, 'жодних записів не зроблено');
});

test('дублікати ID між активними і завершеними проєктами блокують імпорт', () => {
  const project = makeProject({ id: 'dup_project', name: 'Один і той самий' });
  const file = payloadWith([], {
    data: {
      projectsActive: [project],
      projectsCompleted: [{ ...project, name: 'Інша назва' }],
      clients: [],
      specialists: [],
      partners: [],
      transactions: [],
      personalDebts: [],
      savings: [],
    },
  } as Partial<ExportPayload>);

  const result = validateBackup(file);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e =>
    e.id === 'dup_project' && e.message.includes('активні та завершені')), JSON.stringify(result.errors));
});

// ------------------------------------------------------------
// 7. Старий формат комісії партнера
// ------------------------------------------------------------

test('стара комісія (сума) приймається і нормалізується до відсотка', () => {
  const legacy = {
    projectsActive: [makeProject({ budget: 100000, partnerCommission: 5000 })],
    projectsCompleted: [],
    clients: [],
    specialists: [],
    partners: [],
    transactions: [],
    personalDebts: [],
    savings: [],
  };
  const result = validateBackup(legacy);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.format, 'legacy-flat');
  assert.equal(result.counts.projectsActive, 1, 'проєкт не має відкидатися до міграції');
  assert.equal(result.skipped.projectsActive, 0);
  assert.equal(result.content!.projectsActive[0].partnerCommission, 5);
});

test('невизначена одиниця комісії: запис позначається, у строгому режимі — відмова', () => {
  const file = {
    projectsActive: [makeProject({ budget: 100000, partnerCommission: 200000 })],
    projectsCompleted: [],
    clients: [],
    specialists: [],
    partners: [],
    transactions: [],
    personalDebts: [],
    savings: [],
  };

  const soft = validateBackup(file);
  assert.equal(soft.ok, true);
  assert.equal(soft.skipped.projectsActive, 1);
  assert.ok(soft.recordIssues.some(e => e.message.includes('не вдалося визначити одиницю')));

  const strict = validateBackup(file, { strict: true });
  assert.equal(strict.ok, false, 'строгий режим має відхилити імпорт');
  assert.ok(strict.errors.some(e => e.message.includes('Строгий режим')));
});

test('строгий режим відхиляє імпорт із будь-якою помилкою запису', () => {
  const file = payloadWith([
    makeClient({ name: 'Гарний' }),
    { name: 'Без ID' } as unknown as ReturnType<typeof makeClient>,
  ]);
  assert.equal(validateBackup(file).ok, true, 'звичайний режим: лише попередження');
  const strict = validateBackup(file, { strict: true });
  assert.equal(strict.ok, false);
});

// ------------------------------------------------------------
// 8. Час резервної копії та відкладене резервування
// ------------------------------------------------------------

test('час останньої повної копії переживає перезапуск', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [makeClient()]);

  const rotation = rotateBackups(store.getSnapshot(), true);
  assert.equal(rotation.ok, true);
  const stamp = localStorage.getItem('crm_backup_rotated_at');
  assert.ok(stamp && Number(stamp) > 0);

  // «Перезапуск»: пам'ять скинуто, localStorage лишився.
  resetBackupRuntime();
  const status = getBackupRuntimeStatus();
  assert.notEqual(status.lastRotationAt, '', 'час має читатися після перезапуску');
  assert.equal(new Date(status.lastRotationAt).getTime(), Number(stamp));
});

test('відкладена резервна копія виконується після перезапуску без нових змін даних', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [makeClient()]);
  rotateBackups(store.getSnapshot(), true);

  // Симуляція вкладки, убитої браузером: прапорець лишився.
  localStorage.setItem('crm_backup_pending', '1');
  localStorage.setItem('crm_backup_rotated_at', String(Date.now() - 60000));
  resetBackupRuntime();

  await bootStore();
  await new Promise(resolve => setTimeout(resolve, 700));

  assert.equal(localStorage.getItem('crm_backup_pending'), null, 'копія мала виконатися сама');
  assert.ok(localStorage.getItem('crm_backup_1'), 'повну копію створено');
  assert.equal(getBackupRuntimeStatus().pending, false);
});

test('пригнічення backup не «застрягає» після невдалого імпорту', async () => {
  clearAll();
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner, (kind, key, call) =>
    kind === 'collection' && key === 'transactions' && call === 1);
  await bootStore(flaky);
  await store.saveCollection('clients', [makeClient()]);

  const report = await applyImport(payloadWith([makeClient({ name: 'IMPORTED' })]));
  assert.equal(report.ok, false);
  assert.equal(isBackupSuppressed(), false);

  markSnapshotDirty();
  const rotation = rotateBackups(store.getSnapshot(), true);
  assert.equal(rotation.ok, true, 'резервування працює далі');
  assert.ok(localStorage.getItem('crm_backup_1'));
});
