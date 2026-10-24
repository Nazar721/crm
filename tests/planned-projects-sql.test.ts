import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ============================================================
// SQL-інтеграція пакета 06 (PGlite): 001 + 003 + 004 + 005 + 006 на
// справжньому PostgreSQL. Це НЕ перевірка Supabase/PostgREST/RLS/мережі
// чи production. Залежність @electric-sql/pglite — devDependency; без
// неї тест валюється (не рахується як PASS).
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
    hostingServices: [],
    hostingPayments: [],
    tasks: [],
    plannedProjects: [],
    financeSettings: { usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
    meta: { lastSavedAt: '' },
    ...overrides,
  };
}

function planned(id = 'pp1', overrides: Partial<Record<string, unknown>> = {}): AnyRecord {
  return {
    id,
    name: `Сайт для крамниці ${id}`,
    category: 'IT',
    clientName: 'Марія',
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
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
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', '004-hosting.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', '005-tasks.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase', '006-planned-projects.sql'), 'utf8'));
  await db.exec(`
    insert into auth.users values ('${OWNER}');
    insert into public.crm_owners values ('${OWNER}');
    set app.uid = '${OWNER}';
  `);
  return db;
}

async function expectSqlError(db: any, sql: string, params: unknown[], needle: string): Promise<void> {
  let error: any = null;
  try {
    await db.query(sql, params);
  } catch (e) {
    error = e;
  }
  assert.ok(error, `очікувався помилка з «${needle}», але запит виконався`);
  assert.ok(String(error?.message || '').includes(needle), `повідомлення «${error?.message}» має містити «${needle}»`);
}

test('SQL-інтеграція 06: plannedProjects, старий клієнт, undo (PGlite)', {
  timeout: 180000,
}, async () => {
  assert.ok(PGliteCtor, '@electric-sql/pglite обов’язковий (devDependency 0.5.9): виконай npm ci.');
  const g = globalThis as unknown as Record<string, unknown>;
  const savedWindow = g.window;
  const savedNavigator = g.navigator;
  delete g.window;
  delete g.navigator;
  try {
    await runPlannedProjectsSql();
  } finally {
    if (savedWindow !== undefined) g.window = savedWindow;
    if (savedNavigator !== undefined) g.navigator = savedNavigator;
  }
});

async function runPlannedProjectsSql(): Promise<void> {
  const db = await bootDb();
  let rev = 0;
  const commit = async (snapshot: AnyRecord, opts: { source?: string; legacyNoPlanned?: boolean } = {}) => {
    const request = randomUUID();
    let payload: AnyRecord = snapshot;
    if (opts.legacyNoPlanned) {
      // Старий клієнт: snapshot без plannedProjects-ключа узагалі.
      payload = { ...snapshot };
      delete payload.plannedProjects;
    }
    const res = await db.query('select public.crm_commit($1,$2,$3,$4,$5) as rev', [rev, request, JSON.stringify(payload), opts.source ?? 'Форма', null]);
    rev = Number(res.rows[0].rev);
    return { revision: rev, request };
  };
  const undo = async (eventId: string, expectedRevision: number | null = rev) => {
    const res = await db.query('select public.crm_history_undo($1,$2,$3,$4) as r', [eventId, randomUUID(), expectedRevision, 'Форма']);
    const row = res.rows[0].r as AnyRecord;
    if (row && row.revision !== undefined && row.revision !== null) rev = Number(row.revision);
    return res;
  };
  const eventByRequest = async (request: string): Promise<AnyRecord> => {
    const row = (await db.query('select * from public.crm_history where owner_id=$1 and request_id=$2', [OWNER, request])).rows[0];
    assert.ok(row, 'подія має існувати');
    return row as AnyRecord;
  };
  const rowsOf = async (collection: string): Promise<AnyRecord[]> =>
    (await db.query('select payload from public.crm_records where owner_id=$1 and collection=$2 order by position', [OWNER, collection])).rows.map((r: AnyRecord) => r.payload as AnyRecord);

  // ---- crm_read містить plannedProjects ----
  const read0 = await db.query('select public.crm_read() as r');
  const snap0 = (read0.rows[0].r as AnyRecord).snapshot as AnyRecord;
  assert.deepEqual(snap0.plannedProjects, [], 'read повертає порожній масив запланованих проєктів');
  assert.deepEqual(snap0.tasks, [], 'legacy-колекція tasks у read лишилася');

  // ---- commit: секція журналу planned, записи в БД ----
  const ppCommit = await commit(snap({ plannedProjects: [planned('pp1', { plannedDate: '2026-10-27' })] }));
  const ppEvent = await eventByRequest(ppCommit.request);
  assert.equal(ppEvent.section, 'planned', 'секція журналу — planned');
  assert.equal(ppEvent.action, 'create');
  assert.equal((await rowsOf('plannedProjects')).length, 1);
  assert.equal((await rowsOf('plannedProjects'))[0].plannedDate, '2026-10-27', 'JSON payload preserves the planned date');
  const readScheduled = await db.query('select public.crm_read() as r');
  assert.equal((((readScheduled.rows[0].r as AnyRecord).snapshot as AnyRecord).plannedProjects as AnyRecord[])[0].plannedDate, '2026-10-27');

  // ---- Старий клієнт (без plannedProjects-ключа): колекція НЕ стирається ----
  const legacySnap = snap({
    plannedProjects: [planned()],
    clients: [{ id: 'c1', name: 'Клієнт' }],
  });
  await commit(legacySnap); // створити клієнта повним snapshot
  await commit(
    snap({ plannedProjects: [planned()], clients: [{ id: 'c1', name: 'Клієнт оновлений' }] }),
    { legacyNoPlanned: true },
  );
  assert.equal((await rowsOf('plannedProjects')).length, 1, 'старий клієнт не видалив заплановані проєкти');
  assert.equal((await rowsOf('clients'))[0].name, 'Клієнт оновлений', 'решта даних записана');

  // ---- Явний порожній масив (новий клієнт) → перезапис ----
  await commit(snap({ plannedProjects: [], clients: [{ id: 'c1', name: 'Клієнт оновлений' }] }));
  assert.equal((await rowsOf('plannedProjects')).length, 0, 'явний порожній масив перезаписує');

  // ---- Undo: скасування створення (без залежностей) працює ----
  const createAgain = await commit(snap({ plannedProjects: [planned('pp_undo')], clients: [{ id: 'c1', name: 'Клієнт оновлений' }] }));
  const createAgainEvent = await eventByRequest(createAgain.request);
  const undoCreate = await undo(String(createAgainEvent.id));
  assert.equal((undoCreate.rows[0].r as AnyRecord).duplicate, false, 'скасування створення дозволене');
  assert.equal((await rowsOf('plannedProjects')).length, 0);

  // ---- Undo: повернення видаленого запису ----
  const addPp = await commit(snap({ plannedProjects: [planned('pp_back')], clients: [{ id: 'c1', name: 'Клієнт оновлений' }] }));
  void addPp;
  const removePp = await commit(snap({ plannedProjects: [], clients: [{ id: 'c1', name: 'Клієнт оновлений' }] }));
  const removePpEvent = await eventByRequest(removePp.request);
  const undoDelete = await undo(String(removePpEvent.id));
  assert.equal((undoDelete.rows[0].r as AnyRecord).duplicate, false, 'скасування видалення дозволене');
  assert.equal((await rowsOf('plannedProjects')).length, 1, 'запис повернено');

  // ---- Залежність: plannedProjects → clients (clientId) ----
  // Клієнт створено окремою подією; запланований проєкт посилається на нього.
  await commit(snap({ plannedProjects: [], clients: [] }));
  const clientCreate = await commit(snap({ plannedProjects: [], clients: [{ id: 'cdep', name: 'Залежний клієнт' }] }));
  const clientCreateEvent = await eventByRequest(clientCreate.request);
  await commit(snap({
    plannedProjects: [planned('pp_dep', { clientId: 'cdep' })],
    clients: [{ id: 'cdep', name: 'Залежний клієнт' }],
  }));
  const revBeforeDep = (await db.query('select revision from public.crm_state where owner_id=$1', [OWNER])).rows[0].revision;
  await expectSqlError(
    db,
    'select public.crm_history_undo($1,$2,$3,$4)',
    [String(clientCreateEvent.id), randomUUID(), rev, 'Форма'],
    'CRM_UNDO_DEPENDENCY',
  );
  assert.equal((await db.query('select revision from public.crm_state where owner_id=$1', [OWNER])).rows[0].revision, revBeforeDep, 'ревізія незмінна');
  assert.equal((await rowsOf('clients')).some(c => c.id === 'cdep'), true, 'клієнта не прибрано');

  // ---- Залежність (повернення): видалено проєкт, потім клієнта —
  // повернення проєкту з невідомим клієнтом відхиляється без запису.
  const delPp = await commit(snap({ plannedProjects: [], clients: [{ id: 'cdep', name: 'Залежний клієнт' }] }));
  const delPpEvent = await eventByRequest(delPp.request);
  await commit(snap({ plannedProjects: [], clients: [] }));
  const revBeforeRestore = (await db.query('select revision from public.crm_state where owner_id=$1', [OWNER])).rows[0].revision;
  await expectSqlError(
    db,
    'select public.crm_history_undo($1,$2,$3,$4)',
    [String(delPpEvent.id), randomUUID(), rev, 'Форма'],
    'CRM_UNDO_DEPENDENCY',
  );
  assert.equal((await db.query('select revision from public.crm_state where owner_id=$1', [OWNER])).rows[0].revision, revBeforeRestore);
  assert.equal((await rowsOf('plannedProjects')).length, 0, 'проєкт не повернуто без клієнта');

  // ---- Tasks (legacy) лишаються валідними після 006 ----
  const withTask = snap({ tasks: [{ id: 't1', title: 'Написати клієнту', priority: 'high', status: 'planned', dueDate: '2026-10-20' }] });
  const taskCommit = await commit(withTask);
  const taskEvent = await eventByRequest(taskCommit.request);
  assert.equal(taskEvent.section, 'tasks', 'секція журналу — tasks');
  assert.equal((await rowsOf('tasks')).length, 1);

  await db.close();
}
