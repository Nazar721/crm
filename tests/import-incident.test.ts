import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAll, bootStore, makeClient, makeProject, FlakyDataSource, snapshotFingerprint,
} from './helpers';
import { LocalDataSource } from '@/lib/datasource/local';
import * as store from '@/lib/store';
import { applyImport, restoreFromPreviousCopy } from '@/lib/importer';
import { runMigrations } from '@/lib/migrations';
import { listAppliedMigrations } from '@/lib/migration-flags';
import { buildExportPayload } from '@/lib/export';
import { EXPORT_FORMAT_ID, EXPORT_SCHEMA_VERSION, type ExportPayload } from '@/types';

const INCIDENT_KEY = 'crm_import_incomplete';

function payload(overrides: Partial<ExportPayload>): ExportPayload {
  return {
    app: EXPORT_FORMAT_ID,
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: '2026-10-01T08:00:00.000Z',
    data: {
      projectsActive: [], projectsCompleted: [], clients: [], specialists: [],
      partners: [], transactions: [], personalDebts: [], savings: [],
    },
    financeSettings: { usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
    ...overrides,
  } as ExportPayload;
}

// ------------------------------------------------------------
// 1. Стійкість блоку: reinitialize і перезапуск не знімають його
// ------------------------------------------------------------

test('невдале відновлення: блок переживає reinitialize (runMigrations+reload) і повний перезапуск', async () => {
  clearAll();
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner);
  await bootStore(flaky);
  await runMigrations();
  await store.saveCollection('clients', [makeClient({ name: 'ORIGINAL' })]);

  const base = flaky.collectionCalls;
  // Як у репродукції огляду: імпорт падає на transactions, а відновлення — на clients.
  flaky.shouldFail = (kind, key) =>
    kind === 'collection' && key === 'clients' && flaky.collectionCalls > base + 8;
  flaky.failNextOn(['transactions'], base + 1);

  const report = await applyImport(payload({ data: {
    projectsActive: [], projectsCompleted: [], clients: [makeClient({ name: 'IMPORTED' })],
    specialists: [], partners: [], transactions: [], personalDebts: [], savings: [],
  } }));
  assert.equal(report.ok, false);
  assert.equal(report.stage, 'write');
  assert.equal(report.recovered, false);
  assert.equal(store.getSnapshot().clients[0].name, 'IMPORTED', 'змішаний стан');
  assert.ok(store.getWriteBlock(), 'після збою є блок');

  // Те саме, що робить UI через reinitialize після невдалого імпорту.
  await runMigrations();
  await store.reloadStore();
  assert.ok(store.getWriteBlock(), 'reinitialize НЕ знімає блок');
  assert.ok(localStorage.getItem(INCIDENT_KEY), 'мітка лишилася в сховищі');

  // Повний перезапуск сховища.
  store.resetStoreForTests();
  await store.initStore(new LocalDataSource());
  assert.ok(store.getWriteBlock(), 'перезапуск НЕ знімає блок');
  assert.equal(store.getStoreStatus(), 'ready', 'перегляд лишається доступним');

  const blocked = await store.saveCollection('clients', [makeClient()]);
  assert.equal(blocked.ok, false, 'запис користувача заблоковано');

  // Перегляд і експорт доступні.
  assert.equal(store.getSnapshot().clients[0].name, 'IMPORTED');
  const exported = buildExportPayload(store.getSnapshot());
  assert.equal(exported.data.clients.length, 1);
});

test('інцидент ставиться ДО першої зміни основних даних', async () => {
  clearAll();
  const inner = new LocalDataSource();
  let flagAtFirstWrite: string | null = null;
  const flaky = new FlakyDataSource(inner, kind => {
    if (kind === 'collection' && flagAtFirstWrite === null) {
      flagAtFirstWrite = localStorage.getItem(INCIDENT_KEY);
    }
    return false;
  });
  await bootStore(flaky);
  await runMigrations();

  const report = await applyImport(payload({ data: {
    projectsActive: [], projectsCompleted: [], clients: [makeClient({ name: 'NEW' })],
    specialists: [], partners: [], transactions: [], personalDebts: [], savings: [],
  } }));

  assert.equal(report.ok, true, report.issue || '');
  assert.notEqual(flagAtFirstWrite, null, 'мітка має стояти до першого запису колекції');
  assert.equal(localStorage.getItem(INCIDENT_KEY), null, 'після успіху мітку знято');
  assert.equal(store.getWriteBlock(), null);
});

test('переривання імпорту між записами: наступний запуск не дозволяє редагувати змішаний стан', async () => {
  clearAll();
  await bootStore();
  await runMigrations();
  await store.saveCollection('projectsActive', [makeProject({ name: 'Оригінальний' })]);

  // «Аварійне закриття вкладки» посеред імпорту: мітка вже стоїть,
  // частину колекцій уже перезаписано.
  localStorage.setItem(INCIDENT_KEY, JSON.stringify({
    at: new Date().toISOString(),
    reason: 'Імпорт розпочато і не завершено — стан не підтверджено.',
    stage: 'write',
  }));
  localStorage.setItem('clients', JSON.stringify([makeClient({ name: 'ЧАСТКОВО-ІМПОРТОВАНО' })]));
  localStorage.setItem('projects_active', JSON.stringify([makeProject({ name: 'ЧАСТКОВО-ІМПОРТОВАНО' })]));

  store.resetStoreForTests();
  await store.initStore(new LocalDataSource());

  assert.equal(store.getStoreStatus(), 'ready', 'перегляд доступний');
  assert.ok(store.getWriteBlock(), 'змішаний стан заблоковано для редагування');
  assert.ok(store.getWriteBlock()!.includes('Імпорт'), store.getWriteBlock()!);
  assert.equal((await store.saveCollection('clients', [])).ok, false);
  assert.equal(buildExportPayload(store.getSnapshot()).data.clients.length, 1, 'експорт доступний');
  // Дані видно (для діагностики), але не можна правити.
  assert.equal(store.getSnapshot().clients[0].name, 'ЧАСТКОВО-ІМПОРТОВАНО');
});

// ------------------------------------------------------------
// 2. Сирий оригінал пошкодженої колекції
// ------------------------------------------------------------

test('частковий імпорт: сирий оригінал і здоровʼя колекції повертаються', async () => {
  clearAll();
  localStorage.setItem('projects_active', '{broken');
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner, (kind, key, call) =>
    kind === 'collection' && key === 'transactions' && call === 1);
  await bootStore(flaky);
  await runMigrations();

  const beforeClients = snapshotFingerprint();

  const report = await applyImport(payload({ data: {
    projectsActive: [makeProject({ name: 'NEW PROJECT' })], projectsCompleted: [],
    clients: [makeClient({ name: 'NEW' })], specialists: [], partners: [],
    transactions: [], personalDebts: [], savings: [],
  } }));

  assert.equal(report.ok, false);
  assert.equal(report.stage, 'write');
  assert.equal(report.recovered, true, 'сирий оригінал відновлено — стан повність попередній');
  assert.deepEqual(report.restoreSkipped, [], 'пропусків немає');

  // Сирий оригінал на місці, здоровʼя — corrupt.
  assert.equal(localStorage.getItem('projects_active'), '{broken');
  assert.ok(store.getCorruptCollections().includes('projectsActive'));
  // Решта колекцій — попередні.
  assert.deepEqual(store.getSnapshot().clients.map(c => c.name), []);
  assert.equal(beforeClients.includes('NEW'), false);
  // Запис у пошкоджену колекцію заблоковано, глобального блоку немає.
  assert.equal((await store.saveCollection('projectsActive', [])).ok, false);
  assert.equal(store.getWriteBlock(), null, 'стан попередній — глобально не заблоковано');
});

test('сирий оригінал відновити неможливо: recovered=false і стійкий блок', async () => {
  clearAll();
  localStorage.setItem('projects_active', '{broken');
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner, (kind, key, call) =>
    (kind === 'collection' && key === 'transactions' && call === 1));
  await bootStore(flaky);
  await runMigrations();
  flaky.shouldFail = (kind, key, call) =>
    (kind === 'collection' && key === 'transactions' && call === 1) ||
    kind === 'restoreRaw';

  const report = await applyImport(payload({ data: {
    projectsActive: [makeProject({ name: 'NEW PROJECT' })], projectsCompleted: [],
    clients: [], specialists: [], partners: [], transactions: [], personalDebts: [], savings: [],
  } }));

  assert.equal(report.ok, false);
  assert.equal(report.recovered, false, 'без сирого оригіналу не заявляємо повного відновлення');
  assert.deepEqual(report.restoreSkipped, ['projectsActive']);
  assert.ok(store.getWriteBlock(), 'стійкий блок залишається');
  assert.ok(store.getWriteBlocks().importIncident);
  assert.equal(localStorage.getItem(INCIDENT_KEY) !== null, true);
});

test('відновлення не залежить від невдалого запису карантину', async () => {
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
    localStorage.setItem('projects_active', '{broken');
    const inner = new LocalDataSource();
    const flaky = new FlakyDataSource(inner, (kind, key, call) =>
      kind === 'collection' && key === 'transactions' && call === 1);
    await bootStore(flaky);
    await runMigrations();

    const issues = store.getIssues().filter(i => i.kind === 'corrupt_json');
    assert.equal(issues[0].preservedAt, undefined, 'карантин не записався');

    const report = await applyImport(payload({ data: {
      projectsActive: [makeProject({ name: 'NEW PROJECT' })], projectsCompleted: [],
      clients: [], specialists: [], partners: [], transactions: [], personalDebts: [], savings: [],
    } }));

    assert.equal(report.recovered, true,
      'сирий оригінал у памʼяті — карантин не єдина надія');
    assert.equal(localStorage.getItem('projects_active'), '{broken');
    assert.ok(store.getCorruptCollections().includes('projectsActive'));
  } finally {
    (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = originalSet;
  }
});

// ------------------------------------------------------------
// 3. Журнал ≠ здоровʼя даних
// ------------------------------------------------------------

test('«Очистити журнал» не знімає захист пошкодженої колекції', async () => {
  clearAll();
  await bootStore();
  await runMigrations(); // прапорці міграцій уже застосовано

  localStorage.setItem('projects_active', '{broken');
  store.resetStoreForTests();
  await store.initStore(new LocalDataSource());

  assert.ok(store.getCorruptCollections().includes('projectsActive'));
  const issuesBefore = store.getIssues().length;
  assert.ok(issuesBefore > 0);

  store.clearIssues();

  assert.equal(store.getIssues().length, 0, 'журнал очищено');
  assert.ok(store.getCorruptCollections().includes('projectsActive'),
    'здоровʼя даних не залежить від журналу');
  const userWrite = await store.saveCollection('projectsActive', []);
  assert.equal(userWrite.ok, false, 'user-запис заборонено');

  const systemWrite = await store.saveCollection('projectsActive', [], 'system');
  assert.equal(systemWrite.ok, false, 'system-запис (міграції) заборонено');
});

// ------------------------------------------------------------
// 5. Успішне явне відновлення
// ------------------------------------------------------------

test('явне відновлення з копії знімає саме відповідні блоки', async () => {
  clearAll();
  // 1) Спочатку цілісні дані й застосовані міграції…
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner);
  await bootStore(flaky);
  await runMigrations();
  await store.saveCollection('clients', [makeClient({ name: 'ORIGINAL' })]);

  // 2) …і лише потім пошкодження однієї колекції.
  localStorage.setItem('savings', '{broken');
  store.resetStoreForTests();
  await store.initStore(flaky);
  assert.ok(store.getCorruptCollections().includes('savings'));
  assert.equal(store.getSnapshot().clients[0].name, 'ORIGINAL');

  const base = flaky.collectionCalls;
  // Імпорт падає на transactions; відновлення — на clients (одноразово).
  flaky.shouldFail = (kind, key) =>
    kind === 'collection' && key === 'transactions' && flaky.collectionCalls <= base + 8;
  flaky.failNextOn(['clients'], base + 9);

  const failed = await applyImport(payload({ data: {
    projectsActive: [], projectsCompleted: [], clients: [makeClient({ name: 'IMPORTED' })],
    specialists: [], partners: [], transactions: [], personalDebts: [], savings: [],
  } }));
  assert.equal(failed.ok, false);
  assert.equal(failed.recovered, false);
  assert.ok(store.getWriteBlock(), 'до відновлення запис заблоковано');
  assert.equal(store.getSnapshot().clients[0].name, 'IMPORTED', 'змішаний стан');

  // Далі жодних збоїв — явне відновлення має пройти повністю.
  flaky.shouldFail = () => false;

  const restored = await restoreFromPreviousCopy();
  assert.equal(restored.ok, true, restored.issue || '');

  assert.equal(store.getWriteBlock(), null, 'глобальний блок знято — застасунок не заблокований назавжди');
  assert.equal(localStorage.getItem(INCIDENT_KEY), null);
  assert.equal(store.getSnapshot().clients[0].name, 'ORIGINAL', 'дані попереднього стану');

  // Знімаються САМЕ відповідні блоки: пошкоджена колекція лишається захищеною.
  assert.ok(store.getCorruptCollections().includes('savings'));
  assert.equal((await store.saveCollection('savings', [])).ok, false, 'захист пошкодженої колекції збережено');
  assert.equal((await store.saveCollection('clients', [makeClient({ name: 'НОВИЙ' })])).ok, true,
    'решта записів працює');
});

test('успішний повторний імпорт також знімає стійкий інцидент', async () => {
  clearAll();
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner);
  await bootStore(flaky);
  await runMigrations();
  await store.saveCollection('clients', [makeClient({ name: 'ORIGINAL' })]);

  const base = flaky.collectionCalls;
  flaky.shouldFail = (kind, key) =>
    kind === 'collection' && key === 'specialists' && flaky.collectionCalls > base + 8;
  const failed = await applyImport(payload({ data: {
    projectsActive: [], projectsCompleted: [], clients: [makeClient({ name: 'IMPORTED' })],
    specialists: [], partners: [], transactions: [], personalDebts: [], savings: [],
  } }));
  assert.equal(failed.recovered, false);
  assert.ok(store.getWriteBlock());

  flaky.shouldFail = () => false;
  const ok = await applyImport(payload({ data: {
    projectsActive: [], projectsCompleted: [], clients: [makeClient({ name: 'НОВИЙ СТАН' })],
    specialists: [], partners: [], transactions: [], personalDebts: [], savings: [],
  } }));
  assert.equal(ok.ok, true, ok.issue || '');
  assert.equal(store.getWriteBlock(), null, 'повністю успішний імпорт знімає інцидент');
  assert.equal(localStorage.getItem(INCIDENT_KEY), null);
  assert.equal(store.getSnapshot().clients[0].name, 'НОВИЙ СТАН');
  assert.ok(listAppliedMigrations().length > 0, 'міграції відновлено');
});

// ------------------------------------------------------------
// P1: повторне відновлення не губить початкову резервну копію
// ------------------------------------------------------------

test('невдала явна спроба відновлення не перезаписує початкову точку; після перезапуску ORIGINAL повертається', async () => {
  clearAll();
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner);
  await bootStore(flaky);
  await runMigrations();
  await store.saveCollection('clients', [makeClient({ name: 'ORIGINAL' })]);

  const base = flaky.collectionCalls;
  flaky.shouldFail = (kind, key) =>
    kind === 'collection' && key === 'clients' && flaky.collectionCalls > base + 8;
  flaky.failNextOn(['transactions'], base + 1);

  // 1) Невдалий імпорт + невдале автоматичне відновлення.
  const failed = await applyImport(payload({ data: {
    projectsActive: [], projectsCompleted: [], clients: [makeClient({ name: 'IMPORTED' })],
    specialists: [], partners: [], transactions: [], personalDebts: [], savings: [],
  } }));
  assert.equal(failed.ok, false);
  assert.equal(failed.recovered, false);
  assert.equal(store.getSnapshot().clients[0].name, 'IMPORTED');
  assert.ok(store.getWriteBlocks().importIncident);

  const initialCopy = localStorage.getItem('crm_import_previous');
  assert.ok(initialCopy, 'початкову копію створено');
  assert.equal(JSON.parse(initialCopy!).payload.data.clients[0].name, 'ORIGINAL');
  const incidentCopyKey = store.getImportIncident()!.copyKey;
  assert.equal(incidentCopyKey, 'crm_import_previous');

  // 2) Перша явна спроба відновлення — зі збоєм першого запису.
  flaky.shouldFail = () => false;
  flaky.failNextOn(['projectsActive'], flaky.collectionCalls + 1);
  const attempt1 = await restoreFromPreviousCopy();
  assert.equal(attempt1.ok, false, 'спроба мала впасти');

  assert.equal(localStorage.getItem('crm_import_previous'), initialCopy,
    'початкова копія НЕ перезаписана невдалою спробою');
  assert.equal(JSON.parse(localStorage.getItem('crm_import_previous')!).payload.data.clients[0].name, 'ORIGINAL');
  assert.ok(localStorage.getItem('crm_import_attempt'), 'копія спроби зберігається ОКРЕМО');
  assert.equal(store.getSnapshot().clients[0].name, 'IMPORTED', 'стан не змінився');
  assert.equal(store.getImportIncident()!.copyKey, incidentCopyKey, 'інцидент лишається на тій самій точці');

  // 3) Повний перезапуск: стійка мітка переживає й указує на ту саму копію.
  store.resetStoreForTests();
  await store.initStore(new LocalDataSource());
  assert.ok(store.getWriteBlock(), 'інцидент пережив перезапуск');
  assert.equal(store.getImportIncident()!.copyKey, 'crm_import_previous');
  assert.equal(localStorage.getItem('crm_import_previous'), initialCopy);

  // 4) Друга явна спроба — без збоїв.
  const attempt2 = await restoreFromPreviousCopy();
  assert.equal(attempt2.ok, true, attempt2.issue || '');
  assert.equal(store.getSnapshot().clients[0].name, 'ORIGINAL', 'ORIGINAL повернувся');
  assert.equal(store.getWriteBlock(), null, 'інцидент знято після відновлення вибраної точки');
  assert.equal(localStorage.getItem('crm_import_previous'), initialCopy,
    'початкова копія незмінна до завершення');
});

test('повторний невдалий звичайний імпорт під час активного інциденту не губить початкову копію', async () => {
  clearAll();
  const inner = new LocalDataSource();
  const flaky = new FlakyDataSource(inner);
  await bootStore(flaky);
  await runMigrations();
  await store.saveCollection('clients', [makeClient({ name: 'ORIGINAL' })]);

  const base = flaky.collectionCalls;
  flaky.shouldFail = (kind, key) =>
    kind === 'collection' && key === 'clients' && flaky.collectionCalls > base + 8;
  flaky.failNextOn(['transactions'], base + 1);

  await applyImport(payload({ data: {
    projectsActive: [], projectsCompleted: [], clients: [makeClient({ name: 'IMPORTED' })],
    specialists: [], partners: [], transactions: [], personalDebts: [], savings: [],
  } }));
  const initialCopy = localStorage.getItem('crm_import_previous');
  assert.ok(initialCopy);
  assert.equal(JSON.parse(initialCopy!).payload.data.clients[0].name, 'ORIGINAL');
  const initialIncident = store.getImportIncident()!;
  assert.ok(initialIncident.copyKey);

  // Ще один звичайний імпорт (не відновлення) при активному інциденті — зі збоєм.
  flaky.shouldFail = () => false;
  flaky.failNextOn(['projectsActive'], flaky.collectionCalls + 1);
  const second = await applyImport(payload({ data: {
    projectsActive: [], projectsCompleted: [], clients: [makeClient({ name: 'ІМПОРТ-2' })],
    specialists: [], partners: [], transactions: [], personalDebts: [], savings: [],
  } }));

  assert.equal(second.ok, false, 'імпорт мав впасти');
  assert.equal(localStorage.getItem('crm_import_previous'), initialCopy,
    'повторний імпорт НЕ затирає єдину початкову точку відновлення');
  assert.equal(JSON.parse(localStorage.getItem('crm_import_previous')!).payload.data.clients[0].name, 'ORIGINAL');

  const incidentNow = store.getImportIncident();
  assert.ok(incidentNow, 'інцидент активний');
  assert.equal(incidentNow!.copyKey, initialIncident.copyKey, "прив'язка до копії збережена");

  // Відновлення з початкової точки працює.
  const restored = await restoreFromPreviousCopy();
  assert.equal(restored.ok, true, restored.issue || '');
  assert.equal(store.getSnapshot().clients[0].name, 'ORIGINAL');
  assert.equal(store.getWriteBlock(), null);
});
