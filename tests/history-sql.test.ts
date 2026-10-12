import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ============================================================
// SQL-інтеграція пакета 03 на справжньому PostgreSQL (PGlite WASM):
// виконання функцій supabase/001-crm.sql + supabase/003-history.sql
// на ізольованій базі зі синтетичними auth.uid/auth.users/ролями.
// Це НЕ перевірка Supabase/PostgREST, живого RLS, мережі чи production —
// для них потрібен окремий прогін основного агента (див. HANDOFF).
//
// Залежність закріплена як devDependency (`@electric-sql/pglite` 0.5.9,
// package.json + lock): `npm ci` відтворює прогін. Без неї тест НЕ
// пропускається, а валюється (огляд P1: skip ≠ PASS); фокус-гейт —
// `npm run test:sql` (scripts/run-sql-tests.mjs).
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
let PGliteCtor: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  PGliteCtor = require('@electric-sql/pglite').PGlite;
} catch {
  PGliteCtor = null;
}

const ROOT = path.resolve(__dirname, '..', '..');
const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER_OWNER = '22222222-2222-4222-8222-222222222222';

type AnyRecord = Record<string, unknown>;

function snap(overrides: Partial<Record<string, unknown>> = {}): AnyRecord {
  return {
    projectsActive: [],
    projectsCompleted: [],
    clients: [],
    specialists: [],
    partners: [],
    transactions: [],
    personalDebts: [],
    savings: [],
    financeSettings: { usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
    meta: { lastSavedAt: '' },
    ...overrides,
  };
}

async function bootDb(): Promise<any> {
  const db = new PGliteCtor();
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    end $$;
    create schema auth;
    create table auth.users (id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('app.uid', true), '')::uuid
    $$;
  `);
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', '001-crm.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', '003-history.sql'), 'utf8'));
  await db.exec(`
    insert into auth.users values ('${OWNER}'), ('${OTHER_OWNER}');
    insert into public.crm_owners values ('${OWNER}'), ('${OTHER_OWNER}');
    set app.uid = '${OWNER}';
  `);
  return db;
}

async function expectSqlError(db: any, sql: string, params: unknown[], needle: string): Promise<void> {
  // СИНТЕТИЧНИЙ ПОМИЛКОВИЙ ПРОХІД (огляд P1): assert НЕ може бути всередині
  // catch запиту — інакше успішний запит виглядав би як «очікувана відмова».
  let error: any = null;
  try {
    await db.query(sql, params);
  } catch (e) {
    error = e;
  }
  assert.ok(error, `очікувався помилка з «${needle}», але запит виконався`);
  assert.ok(
    String(error?.message || '').includes(needle),
    `повідомлення «${error?.message}» має містити «${needle}»`,
  );
}

test('SQL-інтеграція 003: міграція, commit, undo, ліміти, доступ (PGlite)', {
  timeout: 180000,
}, async () => {
  assert.ok(
    PGliteCtor,
    '@electric-sql/pglite обов’язковий (devDependency 0.5.9): виконай npm ci. SQL-прогін пакета 03 — гейт приймання (npm run test:sql).',
  );
  // Тестове середовище встановлює браузерні глобалі (window); PGlite в Node
  // очікує pure-Node режим — ховаємо їх на час прогону і повертаємо назад.
  const g = globalThis as unknown as Record<string, unknown>;
  const savedWindow = g.window;
  const savedNavigator = g.navigator;
  delete g.window;
  delete g.navigator;
  try {
    await runSqlIntegration();
  } finally {
    if (savedWindow !== undefined) g.window = savedWindow;
    if (savedNavigator !== undefined) g.navigator = savedNavigator;
  }
});

async function runSqlIntegration(): Promise<void> {
  const db = await bootDb();
  // Самоперевірка helper (огляд P1): успішний запит має ВАЛЮВАТИ очікувану
  // відмову, а чужа помилка — не проходити за «нашу».
  await assert.rejects(
    () => expectSqlError(db, 'select 1 as ok', [], 'CRM_'),
    /але запит виконався/,
    'helper не приймає успішний запит як відмову',
  );
  await assert.rejects(
    () => expectSqlError(db, 'select 1/0 as boom', [], 'CRM_'),
    /має містити/,
    'helper вимагає саме очікуваний код помилки',
  );
  let rev = 0;
  const COUNT_SQL = "select count(*)::int as n from public.crm_history where owner_id=$1";
  const historyCount = async (): Promise<number> =>
    (await db.query(COUNT_SQL, [OWNER])).rows[0].n as number;

  const commit = async (snapshot: AnyRecord, opts: { source?: string; action?: string; request?: string; legacy?: boolean } = {}) => {
    const request = opts.request ?? randomUUID();
    const res = opts.legacy
      ? await db.query('select public.crm_commit($1,$2,$3) as rev', [rev, request, JSON.stringify(snapshot)])
      : await db.query('select public.crm_commit($1,$2,$3,$4,$5) as rev', [rev, request, JSON.stringify(snapshot), opts.source ?? null, opts.action ?? null]);
    rev = Number(res.rows[0].rev);
    return { revision: rev, request };
  };
  const eventByRequest = async (request: string): Promise<AnyRecord> => {
    const row = (await db.query('select * from public.crm_history where owner_id=$1 and request_id=$2', [OWNER, request])).rows[0];
    assert.ok(row, `подія для request ${request} має існувати`);
    return row as AnyRecord;
  };
  const settingsNow = async (): Promise<AnyRecord> =>
    (await db.query('select settings from public.crm_state where owner_id=$1', [OWNER])).rows[0].settings as AnyRecord;
  // Допоміжник оновлює rev після КОЖНОГО успішного скасування (rev підвищується).
  const undo = async (eventId: string, request = randomUUID(), expectedRevision: number | null = rev) => {
    const res = await db.query('select public.crm_history_undo($1,$2,$3,$4) as r', [eventId, request, expectedRevision, 'Форма']);
    const row = res.rows[0].r as AnyRecord;
    if (row && row.revision !== undefined && row.revision !== null) rev = Number(row.revision);
    return res;
  };

  // ---- Доступ ----
  await db.exec("set app.uid = ''");
  await expectSqlError(db, 'select public.crm_commit($1,$2,$3)', [rev, randomUUID(), JSON.stringify(snap())], 'CRM_ACCESS_DENIED');
  await expectSqlError(db, 'select public.crm_history_list(10,0,null,null,null,null)', [], 'CRM_ACCESS_DENIED');
  await expectSqlError(db, 'select public.crm_history_undo($1,$2,$3,$4)', [randomUUID(), randomUUID(), 0, 'Форма'], 'CRM_ACCESS_DENIED');
  await db.exec(`set app.uid = '${OTHER_OWNER}'`);
  const foreign = await db.query('select public.crm_history_list(50,0,null,null,null,null) as r');
  assert.equal((foreign.rows[0].r as AnyRecord).total, 0, 'інший власник не бачить чужих подій');
  await db.exec(`set app.uid = '${OWNER}'`);

  // ---- Порожній commit без події; стара 3-арг форма ----
  await commit(snap());
  assert.equal(await historyCount(), 0, 'лише meta/таймстемп — без події');
  const legacy = await commit(snap({ clients: [{ id: 'c_legacy', name: 'Старий клієнт' }] }), { legacy: true });
  const legacyEvent = await eventByRequest(legacy.request);
  assert.equal(legacyEvent.source, 'Застасунок', 'стара сигнатура → типове джерело');
  assert.equal(legacyEvent.action, 'create');
  assert.equal(legacyEvent.section, 'clients');

  // ---- Джерело, ідемпотентність request ID ----
  const twoClients = await commit(
    snap({ clients: [{ id: 'c_legacy', name: 'Старий клієнт' }, { id: 'c_new', name: 'Новий' }] }),
    { source: 'Форма' },
  );
  assert.equal((await eventByRequest(twoClients.request)).source, 'Форма');
  const countBeforeDup = await historyCount();
  const dup = await db.query('select public.crm_commit($1,$2,$3,$4,$5) as rev', [rev, twoClients.request, JSON.stringify(snap({ clients: [{ id: 'c_legacy', name: 'Старий клієнт' }, { id: 'c_new', name: 'Новий' }] })), 'Форма', null]);
  assert.equal(Number(dup.rows[0].rev), rev, 'повтор request ID → та сама ревізія');
  assert.equal(await historyCount(), countBeforeDup, 'повтор не створює події');

  // ---- Валідація ID (jsonb_typeof проти JSON-вузла) ----
  const badSnapshots: [unknown, string][] = [
    [snap({ clients: [{ id: 42, name: 'Число' }] }), 'CRM_INVALID_ID'],
    [snap({ clients: [{ name: 'Без ID' }] }), 'CRM_INVALID_ID'],
    [snap({ clients: [{ id: null, name: 'JSON-null' }] }), 'CRM_INVALID_ID'],
    [snap({ clients: [{ id: '  ', name: 'Порожній' }] }), 'CRM_INVALID_ID'],
    [snap({ clients: [{ id: 'dup', name: 'A' }, { id: 'dup', name: 'B' }] }), 'CRM_DUPLICATE_ID'],
    [snap({ clients: 'не масив' }), 'CRM_INVALID_COLLECTION'],
  ];
  for (const [bad, needle] of badSnapshots) {
    await expectSqlError(db, 'select public.crm_commit($1,$2,$3,$4,$5)', [rev, randomUUID(), JSON.stringify(bad), 'Форма', null], needle);
  }
  await expectSqlError(db, 'select public.crm_commit($1,$2,$3,$4,$5)', [rev + 100, randomUUID(), JSON.stringify(snap()), 'Форма', null], 'CRM_CONFLICT');
  assert.equal(
    (await db.query('select count(*)::int as n from public.crm_records where owner_id=$1', [OWNER])).rows[0].n,
    2,
    'невдалі commit не змінюють записи',
  );

  // ---- Налаштування (allowlist) та meta без подій ----
  const ratedSnap = snap({
    clients: [{ id: 'c_legacy', name: 'Старий клієнт' }, { id: 'c_new', name: 'Новий' }],
    financeSettings: { usdRate: 40, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
  });
  const rated = await commit(ratedSnap, { source: 'Форма' });
  const settingsEvent = await eventByRequest(rated.request);
  assert.equal(settingsEvent.action, 'settings');
  const settingsFields = (settingsEvent.changes as AnyRecord[])[0].fields as AnyRecord[];
  assert.ok(settingsFields.every(f => ['usdRate', 'eurRate', 'usdtRate', 'displayCurrency'].includes(String(f.key))), 'лише allowlist полів');
  const beforeMeta = await historyCount();
  await commit({ ...ratedSnap, meta: { lastSavedAt: new Date().toISOString() } }, { source: 'Форма' });
  assert.equal(await historyCount(), beforeMeta, 'meta-оновлення без нової події');

  // ---- Завершення проєкту: одна група, потім undo (P1.6) ----
  const activeSnap = snap({
    clients: [{ id: 'c_new', name: 'Новий' }],
    projectsActive: [{ id: 'p1', name: 'Проєкт', clientId: 'c_new', clientName: 'Новий' }],
    financeSettings: { usdRate: 40, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
  });
  const activeCommit = await commit(activeSnap, { source: 'Форма' });
  void activeCommit;
  const doneSnap = snap({
    clients: activeSnap.clients,
    projectsCompleted: [{ id: 'p1', name: 'Проєкт', clientId: 'c_new', clientName: 'Новий', status: 'Завершено' }],
    financeSettings: activeSnap.financeSettings,
  });
  const doneCommit = await commit(doneSnap, { source: 'Форма' });
  const completeEvent = await eventByRequest(doneCommit.request);
  assert.equal(completeEvent.action, 'complete', 'перенесення → complete');
  assert.equal((completeEvent.changes as AnyRecord[]).length, 2);
  const completeRev = Number(completeEvent.revision);

  const undoComplete = await undo(String(completeEvent.id), randomUUID(), completeRev);
  assert.equal((undoComplete.rows[0].r as AnyRecord).duplicate, false);
  rev = Number((undoComplete.rows[0].r as AnyRecord).revision);
  assert.equal(
    (await db.query("select count(*)::int as n from public.crm_records where owner_id=$1 and collection='projectsActive'", [OWNER])).rows[0].n,
    1,
    'проєкт повернувся в активні (без CRM_DUPLICATE_PROJECT_ID)',
  );
  assert.equal(
    (await db.query("select count(*)::int as n from public.crm_records where owner_id=$1 and collection='projectsCompleted'", [OWNER])).rows[0].n,
    0,
    'прибрано і завершених',
  );
  const undoRow = (await db.query('select * from public.crm_history where owner_id=$1 and undone_event_id=$2', [OWNER, completeEvent.id])).rows[0] as AnyRecord;
  assert.ok(undoRow, 'подія-відновлення створена');
  assert.equal(
    String((await db.query('select undone_by from public.crm_history where id=$1', [completeEvent.id])).rows[0].undone_by),
    String(undoRow.id),
    'оригінал позначено undone_by',
  );

  // ---- Обов'язкова ревізія; повтор запиту; вже скасовано ----
  const doneAgain = await commit(doneSnap, { source: 'Форма' });
  const complete2 = await eventByRequest(doneAgain.request);
  const complete2Rev = Number(complete2.revision);
  await expectSqlError(db, 'select public.crm_history_undo($1,$2,$3,$4)', [String(complete2.id), randomUUID(), null, 'Форма'], 'CRM_INVALID_REQUEST');
  await expectSqlError(db, 'select public.crm_history_undo($1,$2,$3,$4)', [String(complete2.id), randomUUID(), complete2Rev + 5, 'Форма'], 'CRM_CONFLICT');
  assert.equal(
    (await db.query("select count(*)::int as n from public.crm_records where owner_id=$1 and collection='projectsCompleted'", [OWNER])).rows[0].n,
    1,
    'після конфлікту ревізії нічого не змінено',
  );
  const sharedRequest = randomUUID();
  const firstUndo = await undo(String(complete2.id), sharedRequest, complete2Rev);
  assert.equal((firstUndo.rows[0].r as AnyRecord).duplicate, false);
  rev = Number((firstUndo.rows[0].r as AnyRecord).revision);
  const undoCountBeforeRepeat = (await db.query("select count(*)::int as n from public.crm_history where owner_id=$1 and action='undo'", [OWNER])).rows[0].n;
  const repeatUndo = await undo(String(complete2.id), sharedRequest, rev + 50);
  assert.equal((repeatUndo.rows[0].r as AnyRecord).duplicate, true, 'повтор того самого запиту до ТОЇ САМОЇ події');
  assert.equal(
    (await db.query("select count(*)::int as n from public.crm_history where owner_id=$1 and action='undo'", [OWNER])).rows[0].n,
    undoCountBeforeRepeat,
    'повтор не додає другої події-відновлення',
  );
  await expectSqlError(db, 'select public.crm_history_undo($1,$2,$3,$4)', [String(complete2.id), randomUUID(), rev, 'Форма'], 'CRM_ALREADY_UNDONE');

  // ---- Скасування налаштувань: конфлікт пізнішої зміни та коректний відкат ----
  const rates39 = snap({ clients: [{ id: 'c_new', name: 'Новий' }], financeSettings: { usdRate: 39, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' } });
  const rates39Commit = await commit(rates39, { source: 'Форма' });
  const usdEvent = await eventByRequest(rates39Commit.request);
  // Пізніша зміна того самого поля — конфлікт «після», нічого не перезаписується.
  const rates37 = snap({ clients: [{ id: 'c_new', name: 'Новий' }], financeSettings: { usdRate: 37, eurRate: 45, usdtRate: 41, displayCurrency: 'UAH' } });
  const rates37Commit = await commit(rates37, { source: 'Форма' });
  await expectSqlError(db, 'select public.crm_history_undo($1,$2,$3,$4)', [String(usdEvent.id), randomUUID(), rev, 'Форма'], 'CRM_UNDO_CHANGED');
  let currentSettings = await settingsNow();
  assert.equal(Number(currentSettings.usdRate), 37, 'пізніша зміна не перезаписана');
  assert.equal(Number(currentSettings.eurRate), 45);
  // Коректне скасування останньої події відновлює лише її поля.
  const lastSettingsEvent = await eventByRequest(rates37Commit.request);
  const lastUndo = await undo(String(lastSettingsEvent.id), randomUUID(), rev);
  assert.equal((lastUndo.rows[0].r as AnyRecord).duplicate, false);
  rev = Number((lastUndo.rows[0].r as AnyRecord).revision);
  currentSettings = await settingsNow();
  assert.equal(Number(currentSettings.usdRate), 39, 'usdRate відкочено до «до» події');
  assert.equal(Number(currentSettings.eurRate), 44, 'eurRate відкочено до «до» події');

  // ---- Оплата та залежності ----
  const paySnap = snap({
    clients: [{ id: 'c_new', name: 'Новий' }],
    projectsActive: [{ id: 'p1', name: 'Проєкт', clientId: 'c_new', clientName: 'Новий' }],
    transactions: [{ id: 't1', type: 'income', amount: 500, bank: 'mono', projectId: 'p1', date: '2026-10-01', status: 'done' }],
    financeSettings: await settingsNow(),
  });
  const payCommit = await commit(paySnap, { source: 'Форма', action: 'payment' });
  assert.equal((await eventByRequest(payCommit.request)).action, 'payment', 'підказка payment');
  const payUndo = await undo(String((await eventByRequest(payCommit.request)).id));
  assert.equal((payUndo.rows[0].r as AnyRecord).duplicate, false);
  rev = Number((payUndo.rows[0].r as AnyRecord).revision);
  assert.equal(
    (await db.query("select count(*)::int as n from public.crm_records where owner_id=$1 and collection='transactions'", [OWNER])).rows[0].n,
    0,
    'створення оплати скасовано',
  );

  // Створення клієнта, а ПОТІМ проєкт на нього: прибрати клієнта — конфлікт залежності.
  const depClient = await commit(snap({
    clients: [{ id: 'c_new', name: 'Новий' }, { id: 'c_dep', name: 'Залежний' }],
    projectsActive: [{ id: 'p1', name: 'Проєкт', clientId: 'c_new', clientName: 'Новий' }],
    financeSettings: await settingsNow(),
  }), { source: 'Форма' });
  const depClientEvent = await eventByRequest(depClient.request);
  assert.equal((depClientEvent.changes as AnyRecord[]).some(c => c.id === 'c_dep' && c.change === 'create'), true);
  const depProject = await commit(snap({
    clients: [{ id: 'c_new', name: 'Новий' }, { id: 'c_dep', name: 'Залежний' }],
    projectsActive: [
      { id: 'p1', name: 'Проєкт', clientId: 'c_new', clientName: 'Новий' },
      { id: 'p_dep', name: 'Проєкт_dep', clientId: 'c_dep', clientName: 'Залежний' },
    ],
    financeSettings: await settingsNow(),
  }), { source: 'Форма' });
  void depProject;
  await expectSqlError(db, 'select public.crm_history_undo($1,$2,$3,$4)', [String(depClientEvent.id), randomUUID(), rev, 'Форма'], 'CRM_UNDO_DEPENDENCY');

  // ---- Видалений проєкт: повернення зниклого клієнта відхиляється ----
  const baseAfterDep = snap({
    clients: [{ id: 'c_new', name: 'Новий' }, { id: 'c_dep', name: 'Залежний' }],
    projectsActive: [
      { id: 'p1', name: 'Проєкт', clientId: 'c_new', clientName: 'Новий' },
      { id: 'p_dep', name: 'Проєкт_dep', clientId: 'c_dep', clientName: 'Залежний' },
    ],
    financeSettings: await settingsNow(),
  });
  const removedProject = await commit(snap({ ...baseAfterDep, projectsActive: [(baseAfterDep.projectsActive as AnyRecord[])[0]] }), { source: 'Форма' });
  const removedEvent = await eventByRequest(removedProject.request);
  assert.equal((removedEvent.changes as AnyRecord[]).some(c => c.id === 'p_dep' && c.change === 'delete'), true);
  // Видаляємо ЛИШЕ клієнта: поточні проєкти (p1) мають лишитися як є.
  const withoutDepClient = await commit(snap({
    clients: [(baseAfterDep.clients as AnyRecord[])[0]],
    projectsActive: [(baseAfterDep.projectsActive as AnyRecord[])[0]],
    financeSettings: await settingsNow(),
  }), { source: 'Форма' });
  void withoutDepClient;
  await expectSqlError(db, 'select public.crm_history_undo($1,$2,$3,$4)', [String(removedEvent.id), randomUUID(), rev, 'Форма'], 'CRM_UNDO_DEPENDENCY');

  // ---- P1 (огляд 2): скасування зміни посилання; text=text, не text=jsonb ----
  const refClients = [{ id: 'cA', name: 'A' }, { id: 'cB', name: 'B' }];
  await commit(snap({ clients: refClients, financeSettings: await settingsNow() }), { source: 'Форма' });
  const refWithA = snap({
    clients: refClients,
    projectsActive: [{ id: 'p_ref', name: 'Проєкт_ref', clientId: 'cA', clientName: 'A' }],
    financeSettings: await settingsNow(),
  });
  await commit(refWithA, { source: 'Форма' });
  const refSwitchB = snap({
    clients: refClients,
    projectsActive: [{ id: 'p_ref', name: 'Проєкт_ref', clientId: 'cB', clientName: 'B' }],
    financeSettings: await settingsNow(),
  });
  const switchCommit1 = await commit(refSwitchB, { source: 'Форма' });
  const switchEvent1 = await eventByRequest(switchCommit1.request);
  const undoRef1 = await undo(String(switchEvent1.id));
  assert.equal((undoRef1.rows[0].r as AnyRecord).duplicate, false, 'undo зміни посилання працює (без text=jsonb)');
  rev = Number((undoRef1.rows[0].r as AnyRecord).revision);
  const pRefRestored = (await db.query("select payload from public.crm_records where owner_id=$1 and collection='projectsActive' and id='p_ref'", [OWNER])).rows[0].payload as AnyRecord;
  assert.equal(pRefRestored.clientId, 'cA', 'посилання відкочено до A');
  // Друга зміна посилання, потім видалення A: undo → залежність, без запису.
  const switchCommit2 = await commit(refSwitchB, { source: 'Форма' });
  const switchEvent2 = await eventByRequest(switchCommit2.request);
  const withoutA = snap({
    clients: [refClients[1]],
    projectsActive: [{ id: 'p_ref', name: 'Проєкт_ref', clientId: 'cB', clientName: 'B' }],
    financeSettings: await settingsNow(),
  });
  await commit(withoutA, { source: 'Форма' });
  const revBeforeDep = (await db.query('select revision from public.crm_state where owner_id=$1', [OWNER])).rows[0].revision;
  const undoEventsBeforeDep = (await db.query("select count(*)::int as n from public.crm_history where owner_id=$1 and action='undo'", [OWNER])).rows[0].n;
  await expectSqlError(db, 'select public.crm_history_undo($1,$2,$3,$4)', [String(switchEvent2.id), randomUUID(), rev, 'Форма'], 'CRM_UNDO_DEPENDENCY');
  assert.equal((await db.query('select revision from public.crm_state where owner_id=$1', [OWNER])).rows[0].revision, revBeforeDep, 'ревізія незмінна після залежності');
  assert.equal((await db.query("select count(*)::int as n from public.crm_history where owner_id=$1 and action='undo'", [OWNER])).rows[0].n, undoEventsBeforeDep, 'подій не додано');
  assert.equal(((await db.query("select payload from public.crm_records where owner_id=$1 and collection='projectsActive' and id='p_ref'", [OWNER])).rows[0].payload as AnyRecord).clientId, 'cB', 'запис не змінено');

  // ---- P1 (огляд 2): наявність поля окремо від значення (beforeExists/afterExists) ----
  const descBase = { id: 'p_desc', name: 'З описом', clientId: 'cB', clientName: 'B' };
  await commit(snap({ clients: [refClients[1]], projectsActive: [{ ...descBase, description: 'old note' }], financeSettings: await settingsNow() }), { source: 'Форма' });
  const removeDesc = await commit(snap({ clients: [refClients[1]], projectsActive: [{ ...descBase }], financeSettings: await settingsNow() }), { source: 'Форма' });
  const removeDescEvent = await eventByRequest(removeDesc.request);
  const removeDescField = ((removeDescEvent.changes as AnyRecord[])[0].fields as AnyRecord[]).find(f => f.key === 'description')!;
  assert.equal(removeDescField.afterExists, false, 'прапорець: після — поля немає');
  assert.equal(removeDescField.beforeExists, true, 'прапорець: до — поле було');
  const undoRemoveDesc = await undo(String(removeDescEvent.id));
  assert.equal((undoRemoveDesc.rows[0].r as AnyRecord).duplicate, false, 'undo прибирання опису (раніше падав CRM_UNDO_CHANGED)');
  const descRestored = (await db.query("select payload from public.crm_records where owner_id=$1 and collection='projectsActive' and id='p_desc'", [OWNER])).rows[0].payload as AnyRecord;
  assert.equal(descRestored.description, 'old note', 'опис відкочено');
  // Відсутність → значення: спершу прибираємо опис (без скасування), потім
  // додаємо — undo має прибрати КЛЮЧ, а не записати JSON-null.
  await commit(snap({ clients: [refClients[1]], projectsActive: [{ ...descBase }], financeSettings: await settingsNow() }), { source: 'Форма' });
  const addDesc = await commit(snap({ clients: [refClients[1]], projectsActive: [{ ...descBase, description: 'new note' }], financeSettings: await settingsNow() }), { source: 'Форма' });
  const addDescEvent = await eventByRequest(addDesc.request);
  const undoAddDesc = await undo(String(addDescEvent.id));
  assert.equal((undoAddDesc.rows[0].r as AnyRecord).duplicate, false);
  const descRemovedAgain = (await db.query("select payload from public.crm_records where owner_id=$1 and collection='projectsActive' and id='p_desc'", [OWNER])).rows[0].payload as AnyRecord;
  assert.equal('description' in descRemovedAgain, false, 'відсутнє «до» прибирає ключ, а не null');
  // Значення → явний JSON-null → undo повертає значення; null → значення → undo повертає null.
  await commit(snap({ clients: [refClients[1]], projectsActive: [{ ...descBase, description: null }], financeSettings: await settingsNow() }), { source: 'Форма' });
  const toNull = await commit(snap({ clients: [refClients[1]], projectsActive: [{ ...descBase, description: 'x' }], financeSettings: await settingsNow() }), { source: 'Форма' });
  const undoToNull = await undo(String((await eventByRequest(toNull.request)).id));
  assert.equal((undoToNull.rows[0].r as AnyRecord).duplicate, false);
  const backToNull = (await db.query("select payload from public.crm_records where owner_id=$1 and collection='projectsActive' and id='p_desc'", [OWNER])).rows[0].payload as AnyRecord;
  assert.equal('description' in backToNull, true, 'явний null зберігається ключем');
  assert.equal(backToNull.description, null);
  // Відсутній у налаштуваннях usdtRate: commit додає — undo прибирає ключ.
  const noUsdt = { usdRate: 40, eurRate: 44, displayCurrency: 'UAH' };
  await commit(snap({ clients: [refClients[1]], financeSettings: noUsdt }), { source: 'Форма' });
  const settingsBeforeUsdt = (await db.query('select settings from public.crm_state where owner_id=$1', [OWNER])).rows[0].settings as AnyRecord;
  assert.equal('usdtRate' in settingsBeforeUsdt, false);
  const withUsdt = { usdRate: 40, eurRate: 44, usdtRate: 99, displayCurrency: 'UAH' };
  const addUsdt = await commit(snap({ clients: [refClients[1]], financeSettings: withUsdt }), { source: 'Форма' });
  const undoUsdt = await undo(String((await eventByRequest(addUsdt.request)).id));
  assert.equal((undoUsdt.rows[0].r as AnyRecord).duplicate, false);
  const settingsAfterUsdtUndo = (await db.query('select settings from public.crm_state where owner_id=$1', [OWNER])).rows[0].settings as AnyRecord;
  assert.deepEqual(settingsAfterUsdtUndo, settingsBeforeUsdt, 'повний стан налаштувань відкочено, включно з відсутнім usdtRate');

  // ---- Імпорт: підсумок, без скасування ----
  const importCommit = await commit(snap({ clients: [{ id: 'i1', name: 'І1' }, { id: 'i2', name: 'І2' }] }), { source: 'Імпорт' });
  const importEvent = await eventByRequest(importCommit.request);
  assert.equal(importEvent.action, 'import');
  assert.equal(importEvent.section, 'import');
  assert.ok((importEvent.changes as AnyRecord[]).every(c => c.change === 'bulk'), 'імпорт — лише підсумок');
  await expectSqlError(db, 'select public.crm_history_undo($1,$2,$3,$4)', [String(importEvent.id), randomUUID(), rev, 'Форма'], 'CRM_UNDO_NOT_ALLOWED');

  // ---- Ідемпотентність прив'язана до події ----
  const createSolo = await commit(snap({
    clients: [{ id: 'i1', name: 'І1' }, { id: 'i2', name: 'І2' }, { id: 'i3', name: 'І3' }],
  }), { source: 'Форма' });
  const soloEvent = await eventByRequest(createSolo.request);
  const reused = randomUUID();
  const soloUndo = await undo(String(soloEvent.id), reused);
  assert.equal((soloUndo.rows[0].r as AnyRecord).duplicate, false);
  rev = Number((soloUndo.rows[0].r as AnyRecord).revision);
  const createAnother = await commit(snap({
    clients: [{ id: 'i1', name: 'І1' }, { id: 'i2', name: 'І2' }, { id: 'i3', name: 'І3' }, { id: 'i4', name: 'І4' }],
  }), { source: 'Форма' });
  const anotherEvent = await eventByRequest(createAnother.request);
  const sameRequestOtherEvent = await undo(String(anotherEvent.id), reused);
  assert.equal((sameRequestOtherEvent.rows[0].r as AnyRecord).duplicate, false, 'той самий request для ІНШОЇ події — не дубль');
  rev = Number((sameRequestOtherEvent.rows[0].r as AnyRecord).revision);
  assert.equal(
    (await db.query('select count(*)::int as n from public.crm_history where owner_id=$1 and request_id=$2 and action=$3', [OWNER, reused, 'undo'])).rows[0].n,
    2,
    'дві undo-події з тим самим request, але різними цілями',
  );

  // ---- Ліміти: застарілі події + захист утримуваного recovery-посилання ----
  const protectedCommit = await commit(snap({
    clients: [{ id: 'i1', name: 'І1' }, { id: 'i2', name: 'І2' }, { id: 'i3', name: 'І3' }, { id: 'i4', name: 'І4' }, { id: 'i5', name: 'Захист' }],
  }), { source: 'Форма' });
  const protectedEvent = await eventByRequest(protectedCommit.request);
  // Робимо подію «протермінованою», потім скасовуємо її (пара).
  await db.query("update public.crm_history set at = now() - interval '100 days' where id = $1", [String(protectedEvent.id)]);
  const protectedUndo = await undo(String(protectedEvent.id));
  assert.equal((protectedUndo.rows[0].r as AnyRecord).duplicate, false);
  rev = Number((protectedUndo.rows[0].r as AnyRecord).revision);
  // Ще одна незахищена застаріла подія.
  const plainOld = (await db.query("select id from public.crm_history where owner_id=$1 and undone_event_id is null and undone_by is null and action='create' order by at asc limit 1", [OWNER])).rows[0];
  await db.query("update public.crm_history set at = now() - interval '100 days' where id = $1", [String(plainOld.id)]);
  // Наступний commit запускає cleanup.
  await commit(snap({ clients: [{ id: 'i9', name: 'Фінальний' }] }), { source: 'Форма' });
  assert.equal(
    (await db.query('select count(*)::int as n from public.crm_history where owner_id=$1 and id=$2', [OWNER, String(protectedEvent.id)])).rows[0].n,
    1,
    'застаріла ціль утримуваного відновлення ЗАХИЩЕНА',
  );
  assert.equal(
    (await db.query('select count(*)::int as n from public.crm_history where owner_id=$1 and id=$2', [OWNER, String(plainOld.id)])).rows[0].n,
    0,
    'незахищена застаріла подія видалена',
  );

  await db.close();
}
