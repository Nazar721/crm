import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ============================================================
// SQL-інтеграція пакета 04 (PGlite): 001 + 003 + 004 на справжньому
// PostgreSQL. Це НЕ перевірка Supabase/PostgREST/RLS/мережі/production.
// Залежність @electric-sql/pglite — devDependency; без неї тест валюється.
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
    financeSettings: { usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
    meta: { lastSavedAt: '' },
    ...overrides,
  };
}

function hostingService(id = 'hs1', name = 'Квіти'): AnyRecord {
  return { id, name, site: 'kvity.ua', provider: 'Хостер', currency: 'UAH', archived: false };
}

function hostingPayment(id: string, serviceId: string, overrides: Partial<Record<string, unknown>> = {}): AnyRecord {
  return { id, serviceId, date: '2026-10-12', amount: 1200, currency: 'UAH', periodStart: '2026-10-12', periodEnd: '2027-10-11', ...overrides };
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

test('SQL-інтеграція 04: хостинг-колекції, старий клієнт, undo (PGlite)', {
  timeout: 180000,
}, async () => {
  assert.ok(PGliteCtor, '@electric-sql/pglite обов’язковий (devDependency 0.5.9): виконай npm ci.');
  const g = globalThis as unknown as Record<string, unknown>;
  const savedWindow = g.window;
  const savedNavigator = g.navigator;
  delete g.window;
  delete g.navigator;
  try {
    await runHostingSql();
  } finally {
    if (savedWindow !== undefined) g.window = savedWindow;
    if (savedNavigator !== undefined) g.navigator = savedNavigator;
  }
});

async function runHostingSql(): Promise<void> {
  const db = await bootDb();
  let rev = 0;
  const commit = async (snapshot: AnyRecord, opts: { source?: string; legacyNoHosting?: boolean } = {}) => {
    const request = randomUUID();
    let payload: AnyRecord = snapshot;
    if (opts.legacyNoHosting) {
      // Старий клієнт: snapshot без hosting-ключів узагалі.
      payload = { ...snapshot };
      delete payload.hostingServices;
      delete payload.hostingPayments;
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

  // ---- crm_read містить нові колекції ----
  const read0 = await db.query('select public.crm_read() as r');
  const snap0 = (read0.rows[0].r as AnyRecord).snapshot as AnyRecord;
  assert.deepEqual(snap0.hostingServices, [], 'read повертає порожній масив послуг');
  assert.deepEqual(snap0.hostingPayments, []);

  // ---- commit з хостингом: журнал секції hosting, записи в БД ----
  const withHosting = snap({ hostingServices: [hostingService()], hostingPayments: [hostingPayment('hp1', 'hs1')] });
  const hcommit = await commit(withHosting, { source: 'Форма' });
  const hostingEvent = await eventByRequest(hcommit.request);
  assert.equal(hostingEvent.section, 'hosting', 'секція журналу — hosting');
  assert.equal(hostingEvent.action, 'create');
  assert.equal((await rowsOf('hostingServices')).length, 1);
  assert.equal((await rowsOf('hostingPayments')).length, 1);

  // ---- Старий клієнт (без hosting-ключів): нові колекції НЕ стираються ----
  const legacySnap = snap({
    hostingServices: [hostingService()],
    hostingPayments: [hostingPayment('hp1', 'hs1')],
    clients: [{ id: 'c1', name: 'Клієнт' }],
  });
  await commit(legacySnap); // створити клієнта повним snapshot
  const legacyCommit = await commit({ ...legacySnap, clients: [{ id: 'c1', name: 'Клієнт оновлений' }] }, { legacyNoHosting: true });
  void legacyCommit;
  assert.equal((await rowsOf('hostingServices')).length, 1, 'старий клієнт не видалив хостинг');
  assert.equal((await rowsOf('hostingPayments')).length, 1, 'оплати збережені');
  assert.equal((await rowsOf('clients'))[0].name, 'Клієнт оновлений', 'решта даних записана');

  // ---- Явні порожні масиви (новий клієнт) → перезапис (визначений сенс) ----
  await commit(snap({ clients: [{ id: 'c1', name: 'Клієнт оновлений' }] }));
  assert.equal((await rowsOf('hostingServices')).length, 0, 'явний порожній масив перезаписує');

  // ---- Undo: створення оплати; залежність оплати від картки ----
  const restoreHosting = snap({ hostingServices: [hostingService()], hostingPayments: [hostingPayment('hp1', 'hs1')] });
  await commit(restoreHosting);
  const serviceOnly = snap({ hostingServices: [hostingService()], hostingPayments: [] });
  const removePayments = await commit(serviceOnly);
  const removeEvent = await eventByRequest(removePayments.request);
  const undoPayment = await undo(String(removeEvent.id));
  assert.equal((undoPayment.rows[0].r as AnyRecord).duplicate, false, 'скасування видалення оплати працює');
  assert.equal((await rowsOf('hostingPayments')).length, 1, 'оплату повернено');

  // Видалення картки за наявної оплати: подальше ВІДНОВЛЕННЯ картки законне
  // (оплати знову мають чинне посилання — це не створює завислих).
  const deleteService = await commit(snap({ hostingServices: [], hostingPayments: [hostingPayment('hp1', 'hs1')] }));
  const deleteServiceEvent = await eventByRequest(deleteService.request);
  const restoreService = await undo(String(deleteServiceEvent.id));
  assert.equal((restoreService.rows[0].r as AnyRecord).duplicate, false, 'відновлення видаленої картки дозволене');
  assert.equal((await rowsOf('hostingServices')).length, 1);
  assert.equal((await rowsOf('hostingPayments')).length, 1);

  // Залежність (створення): картка створена окремою подією, оплата — пізніше;
  // скасування СТВОРЕННЯ картки за наявної оплати → CRM_UNDO_DEPENDENCY.
  await commit(snap({ hostingServices: [], hostingPayments: [] }));
  const depCreate = await commit(snap({ hostingServices: [hostingService('hs_dep', 'Залежний')], hostingPayments: [] }));
  const depCreateEvent = await eventByRequest(depCreate.request);
  assert.equal((depCreateEvent.changes as AnyRecord[]).some(c => c.id === 'hs_dep' && c.change === 'create'), true);
  await commit(snap({ hostingServices: [hostingService('hs_dep', 'Залежний')], hostingPayments: [hostingPayment('hp_dep', 'hs_dep')] }));
  const revBeforeDep = (await db.query('select revision from public.crm_state where owner_id=$1', [OWNER])).rows[0].revision;
  await expectSqlError(
    db,
    'select public.crm_history_undo($1,$2,$3,$4)',
    [String(depCreateEvent.id), randomUUID(), rev, 'Форма'],
    'CRM_UNDO_DEPENDENCY',
  );
  assert.equal((await db.query('select revision from public.crm_state where owner_id=$1', [OWNER])).rows[0].revision, revBeforeDep, 'ревізія незмінна');
  assert.equal((await rowsOf('hostingServices')).some(h => h.id === 'hs_dep'), true, 'картку не прибрано');

  // Залежність (повернення оплати): оплату видалено, потім її картку —
  // повернення оплати з невідомою карткою відхиляється без запису.
  await commit(snap({ hostingServices: [], hostingPayments: [hostingPayment('hp_dep', 'hs_dep')] }));
  const delPay = await commit(snap({ hostingServices: [], hostingPayments: [] }));
  const delPayEvent = await eventByRequest(delPay.request);
  const revBeforeRestore = (await db.query('select revision from public.crm_state where owner_id=$1', [OWNER])).rows[0].revision;
  await expectSqlError(
    db,
    'select public.crm_history_undo($1,$2,$3,$4)',
    [String(delPayEvent.id), randomUUID(), rev, 'Форма'],
    'CRM_UNDO_DEPENDENCY',
  );
  assert.equal((await db.query('select revision from public.crm_state where owner_id=$1', [OWNER])).rows[0].revision, revBeforeRestore);
  assert.equal((await rowsOf('hostingPayments')).length, 0, 'оплату не повернуто без картки');

  await db.close();
}
