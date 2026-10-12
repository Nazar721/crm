import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvent, buildEventFromSnapshots, computeUndoPlan, deepEqual,
  enforceHistoryLimits, normalizeHistoryEvent, patchSnapshot,
} from '@/lib/history/engine';
import { isUndoable, type HistoryEvent } from '@/lib/history/types';
import {
  buildHistoryExport, clearImportedHistory, importHistoryPayload, readImportedHistory,
} from '@/lib/history/overlay';
import { getWriteContext, runWithWriteContext, resetWriteContext } from '@/lib/history/source';
import * as store from '@/lib/store';
import { saveProject, completeProject, saveRates, recordProjectPayment, applyAssistantPlan } from '@/lib/actions';
import { normalizePlan, fingerprint } from '@/lib/assistant/plan';
import { migrate } from '@/lib/migrations';
import { applyImport } from '@/lib/importer';
import { buildExportPayload } from '@/lib/export';
import { SupabaseDataSource } from '@/lib/datasource/supabase';
import { LocalDataSource } from '@/lib/datasource/local';
import { clearAll, bootStore, emptySnapshot, makeClient, makeProject, makeTransaction } from './helpers';
import type { Client, DataSnapshot, Project } from '@/types';

// ============================================================
// Пакет 03: журнал історії та скасування.
// Remote-тести нижче перевіряють ЛИШЕ КОНТРАКТ клієнта (імена rpc,
// аргументи, мапінг помилок) — це НЕ перевірка реального SQL;
// SQL-поведінку перевіряє основний агент на контрольованій БД
// (репродукції в HANDOFF-PACKAGE-03).
// ============================================================

function snapshotOf(parts: Partial<DataSnapshot> & { financeSettings?: DataSnapshot['financeSettings'] }): DataSnapshot {
  const base = emptySnapshot();
  return { ...base, ...parts };
}

async function listAll(): Promise<HistoryEvent[]> {
  const result = await store.listHistory({ limit: 200, offset: 0 });
  return result.events;
}

// ------------------------------------------------------------
// Engine: різниця → подія
// ------------------------------------------------------------

test('engine: створення/оновлення/видалення та налаштування дають одну групу змістових змін', () => {
  const before = snapshotOf({ clients: [makeClient({ id: 'c1', name: 'Олег' })] });
  const after = snapshotOf({
    clients: [makeClient({ id: 'c1', name: 'Олег Он.' }), makeClient({ id: 'c2', name: 'Анна' })],
    financeSettings: { usdRate: 42, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
  });
  const event = buildEventFromSnapshots(before, after, { source: 'Форма' })!;
  assert.ok(event, 'подія має існувати');
  assert.equal(event.action, 'update');
  assert.equal(event.section, 'clients');
  const kinds = event.changes.map(c => `${c.collection}:${c.change}`).sort();
  assert.deepEqual(kinds, ['clients:create', 'clients:update', 'settings:update']);
  const update = event.changes.find(c => c.change === 'update' && c.collection === 'clients')!;
  assert.deepEqual(update.fields!.map(f => f.key), ['name']);
  assert.match(event.summary, /Змінено/);
  assert.equal(update.label, 'Олег Он.', 'підпис береться з актуального запису');
});

test('engine: зміни лише службових meta не журналуються', () => {
  const before = snapshotOf({});
  const after = snapshotOf({});
  after.meta = { ...after.meta, lastSavedAt: '2026-10-12T10:00:00.000Z' };
  assert.equal(buildEventFromSnapshots(before, after, { source: 'Форма' }), null);
});

test('engine: завершення проєкту — одна група action=complete з двома колекціями', () => {
  const project = makeProject({ id: 'p1', clientId: '', clientName: 'Клієнт' });
  const before = snapshotOf({ projectsActive: [project] });
  const after = snapshotOf({ projectsCompleted: [project] });
  const event = buildEventFromSnapshots(before, after, { source: 'Форма' })!;
  assert.equal(event.action, 'complete');
  assert.equal(event.section, 'projects');
  assert.equal(event.changes.length, 2);
  assert.equal(event.summary, `Завершено «${project.name}»`);
});

test('engine: імпорт — підсумок без вмісту, розділ системні, скасування недоступне', () => {
  const before = snapshotOf({});
  const after = snapshotOf({
    clients: [makeClient({ id: 'c1', name: 'A' }), makeClient({ id: 'c2', name: 'B' })],
    transactions: [makeTransaction({ id: 't1' })],
  });
  const event = buildEventFromSnapshots(before, after, { source: 'Імпорт', hint: 'import' })!;
  assert.equal(event.action, 'import');
  assert.equal(event.section, 'import');
  assert.ok(event.changes.every(c => c.change === 'bulk'), 'без повного JSON записів');
  assert.equal(isUndoable(event), false);
  assert.match(event.summary, /Імпорт даних \(\+3 −0 ~0\)/);
});

test('engine: група понад 50 змін стає підсумком без скасування', () => {
  const many = Array.from({ length: 60 }, (_, i) => makeClient({ id: `c${i}`, name: `Клієнт ${i}` }));
  const event = buildEventFromSnapshots(snapshotOf({}), snapshotOf({ clients: many }), { source: 'Форма' })!;
  assert.ok(event.changes.every(c => c.change === 'bulk'));
  assert.equal(isUndoable(event), false);
});

test('engine: підказка payment уточнює мітку дії', () => {
  const before = snapshotOf({ projectsActive: [makeProject({ id: 'p1', prepayment: 0 })] });
  const after = snapshotOf({ projectsActive: [makeProject({ id: 'p1', prepayment: 5000 })] });
  const event = buildEventFromSnapshots(before, after, { source: 'Форма', hint: 'payment' })!;
  assert.equal(event.action, 'payment');
});

test('engine: секрети не потрапляють у подію', () => {
  const dirty = { ...makeClient({ id: 'c1', name: 'A' }), apiKey: 'sk-secret', token: 'abc' } as never;
  const event = buildEventFromSnapshots(snapshotOf({}), snapshotOf({ clients: [dirty] }), { source: 'Форма' })!;
  const json = JSON.stringify(event);
  assert.equal(/sk-secret|apiKey|"token"/.test(json), false, 'секретні поля вилучено');
});

test('engine: ліміти — 90 днів, 2000 подій і захист recovery-посилань', () => {
  const now = Date.now();
  const iso = (offsetDays: number) => new Date(now - offsetDays * 86400000).toISOString();
  const event = (id: string, at: string, extra: Partial<HistoryEvent> = {}): HistoryEvent => ({
    id, at, requestId: null, revision: null, section: 'clients', action: 'update', source: 'Форма',
    summary: id, changes: [{ collection: 'clients', id: 'c1', change: 'update', fields: [] }],
    group: id, undoneBy: null, undoneEventId: null, ...extra,
  });
  // Стара подія, на яку посилається утримуване відновлення, лишається.
  const old = event('old', iso(100));
  const undo = event('undo', iso(1), { action: 'undo', undoneEventId: 'old' });
  const plainOld = event('plain-old', iso(100));
  const kept = enforceHistoryLimits([old, undo, plainOld, event('fresh', iso(0))], now);
  const ids = kept.map(e => e.id).sort();
  assert.deepEqual(ids, ['fresh', 'old', 'undo'], 'протекторована пара вціліла, зайва стара — ні');
  // Понад 2000: тримається найновіша тисяча.
  const many = Array.from({ length: 2100 }, (_, i) => event(`e${i}`, new Date(now - i * 1000).toISOString()));
  const limited = enforceHistoryLimits(many, now);
  assert.equal(limited.length, 2000);
  assert.equal(limited[0].id, 'e0');
});

test('engine: normalizeHistoryEvent відкидає сміття і вилучає секрети', () => {
  assert.equal(normalizeHistoryEvent(null), null);
  assert.equal(normalizeHistoryEvent({ id: 'x' }), null);
  assert.equal(normalizeHistoryEvent({ id: 'x', at: 'не дата', section: 'clients', action: 'update', source: 'Форма', summary: '', changes: [] }), null);
  const raw = {
    id: 'evt1', at: new Date().toISOString(), section: 'clients', action: 'update', source: 'Форма',
    summary: 'тест', changes: [{ collection: 'clients', id: 'c1', change: 'delete', before: { id: 'c1', name: 'A', apiKey: 'sk-x' } }],
  };
  const event = normalizeHistoryEvent(raw)!;
  assert.ok(event);
  assert.equal(JSON.stringify(event).includes('sk-x'), false);
  assert.equal(normalizeHistoryEvent({ ...raw, changes: [{ collection: 'вигадка', id: 'x', change: 'update' }] }), null);
});

// ------------------------------------------------------------
// Engine: план відновлення
// ------------------------------------------------------------

function changeEvent(changes: HistoryEvent['changes'], extra: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id: 'evt', at: new Date().toISOString(), requestId: null, revision: null,
    section: 'clients', action: 'update', source: 'Форма', summary: 'тест',
    changes, group: 'evt', undoneBy: null, undoneEventId: null, ...extra,
  };
}

test('undo-plan: оновлення відновлює лише змінені поля, непов’язані зміни зберігаються', () => {
  const client = makeClient({ id: 'c1', name: 'Нове ім’я', telegram: '@new', source: 'Telegram' });
  const event = changeEvent([{
    collection: 'clients', id: 'c1', change: 'update',
    fields: [{ key: 'name', before: 'Старе ім’я', after: 'Нове ім’я' }],
  }]);
  const plan = computeUndoPlan(event, snapshotOf({ clients: [client] }));
  assert.ok(plan.ok);
  const restored = plan.ok && plan.patch.collections!.clients![0] as Record<string, unknown>;
  assert.ok(restored);
  assert.equal(restored!.name, 'Старе ім’я');
  assert.equal(restored!.telegram, '@new', 'інші поля не чіпаються');
});

test('undo-plan: конфлікт, якщо поле змінилося після події', () => {
  const client = makeClient({ id: 'c1', name: 'Ще новіше', telegram: '@new' });
  const event = changeEvent([{
    collection: 'clients', id: 'c1', change: 'update',
    fields: [{ key: 'name', before: 'Старе', after: 'Нове' }],
  }]);
  const plan = computeUndoPlan(event, snapshotOf({ clients: [client] }));
  assert.equal(plan.ok, false);
  assert.ok(!plan.ok && plan.conflicts.some(c => c.includes('змінилося після')));
});

test('undo-plan: скасування створення блокується залежністю від проєкту', () => {
  const client = makeClient({ id: 'c1', name: 'A' });
  const event = changeEvent([{
    collection: 'clients', id: 'c1', change: 'create', after: { ...client },
  }]);
  const plan = computeUndoPlan(event, snapshotOf({
    clients: [client],
    projectsActive: [makeProject({ id: 'p1', clientId: 'c1' })],
  }));
  assert.equal(plan.ok, false);
  assert.ok(!plan.ok && plan.conflicts.some(c => c.includes('посилається')));
});

test('undo-plan: скасування створення без залежностей прибирає запис', () => {
  const client = makeClient({ id: 'c1', name: 'A' });
  const event = changeEvent([{
    collection: 'clients', id: 'c1', change: 'create', after: { ...client },
  }]);
  const plan = computeUndoPlan(event, snapshotOf({ clients: [client] }));
  assert.ok(plan.ok);
  assert.equal(plan.ok && plan.patch.collections!.clients!.length, 0);
});

test('undo-plan: повернення видаленого — вільний ID та валідні посилання', () => {
  const project = makeProject({ id: 'p1', clientId: 'c1', clientName: 'A' });
  // ID зайнятий → конфлікт.
  const busy = computeUndoPlan(
    changeEvent([{ collection: 'projectsActive', id: 'p1', change: 'delete', before: project as unknown as Record<string, unknown> }]),
    snapshotOf({ projectsActive: [project] }),
  );
  assert.equal(busy.ok, false);
  // Вільний ID, але клієнт зник → конфлікт посилань.
  const dangling = computeUndoPlan(
    changeEvent([{ collection: 'projectsActive', id: 'p1', change: 'delete', before: project as unknown as Record<string, unknown> }]),
    snapshotOf({ projectsActive: [] }),
  );
  assert.equal(dangling.ok, false);
  assert.ok(!dangling.ok && dangling.conflicts.some(c => c.includes('clientId')));
  // Валідний випадок → повертається.
  const ok = computeUndoPlan(
    changeEvent([{ collection: 'projectsActive', id: 'p1', change: 'delete', before: project as unknown as Record<string, unknown> }]),
    snapshotOf({ projectsActive: [], clients: [makeClient({ id: 'c1', name: 'A' })] }),
  );
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.patch.collections!.projectsActive!.length, 1);
});

test('undo-plan: скасування завершення повертає проєкт в активні без дубля ID', () => {
  const project = makeProject({ id: 'p1', clientId: '', clientName: 'A' });
  const event = changeEvent([
    { collection: 'projectsActive', id: 'p1', change: 'delete', before: project as unknown as Record<string, unknown>, label: 'A' },
    { collection: 'projectsCompleted', id: 'p1', change: 'create', after: project as unknown as Record<string, unknown>, label: 'A' },
  ], { section: 'projects', action: 'complete' });
  const plan = computeUndoPlan(event, snapshotOf({ projectsCompleted: [project] }));
  assert.ok(plan.ok);
  assert.equal(plan.ok && plan.patch.collections!.projectsActive!.length, 1);
  assert.equal(plan.ok && plan.patch.collections!.projectsCompleted!.length, 0);
  // Якщо проєкт уже повернули вручну — конфлікт унікальності/стану.
  const conflict = computeUndoPlan(event, snapshotOf({ projectsActive: [project], projectsCompleted: [project] }));
  assert.equal(conflict.ok, false);
});

test('undo-plan: налаштування відновлюються за allowlist із перевіркою «після»', () => {
  const event = changeEvent([{
    collection: 'settings', id: 'settings', change: 'update',
    fields: [{ key: 'usdRate', before: 41, after: 42 }],
  }], { section: 'settings', action: 'settings' });
  const current = snapshotOf({ financeSettings: { usdRate: 42, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' } });
  const plan = computeUndoPlan(event, current);
  assert.ok(plan.ok);
  assert.equal(plan.ok && plan.patch.settings!.usdRate, 41);
  const conflicted = computeUndoPlan(event, snapshotOf({ financeSettings: { usdRate: 45, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' } }));
  assert.equal(conflicted.ok, false);
});

test('undo-plan: група атомарна — один конфлікт відхиляє весь патч', () => {
  const a = makeClient({ id: 'c1', name: 'A' });
  const b = makeClient({ id: 'c2', name: 'B' });
  const event = changeEvent([
    { collection: 'clients', id: 'c1', change: 'update', fields: [{ key: 'name', before: 'Стара A', after: 'A' }] },
    { collection: 'clients', id: 'c2', change: 'update', fields: [{ key: 'name', before: 'Стара B', after: 'B' }] },
  ]);
  const current = snapshotOf({ clients: [a, { ...b, name: 'Змінена B' }] });
  const plan = computeUndoPlan(event, current);
  assert.equal(plan.ok, false);
});

test('undo-plan: наявність поля окремо від значення (ревізія 3)', () => {
  // значення → відсутність: «після» = ключа немає → поточний без ключа проходить.
  const noDesc = makeClient({ id: 'c1', name: 'A' });
  const removeDesc = changeEvent([{
    collection: 'clients', id: 'c1', change: 'update',
    fields: [{ key: 'description', before: 'note', after: undefined }],
  }]);
  const removePlan = computeUndoPlan(removeDesc, snapshotOf({ clients: [noDesc] }));
  assert.ok(removePlan.ok, 'відсутність «після» не є конфліктом, якщо ключа немає');
  const restored = removePlan.ok && removePlan.patch.collections!.clients![0] as Record<string, unknown>;
  assert.equal(restored!.description, 'note');

  // відсутність → значення: undo прибирає КЛЮЧ, а не пише null.
  const withDesc = { ...makeClient({ id: 'c1', name: 'A' }), description: 'new' };
  const addDesc = changeEvent([{
    collection: 'clients', id: 'c1', change: 'update',
    fields: [{ key: 'description', before: undefined, after: 'new' }],
  }]);
  const addPlan = computeUndoPlan(addDesc, snapshotOf({ clients: [withDesc] }));
  assert.ok(addPlan.ok);
  const stripped = addPlan.ok && addPlan.patch.collections!.clients![0] as Record<string, unknown>;
  assert.equal('description' in stripped!, false, 'відсутнє «до» прибирає ключ, а не null');

  // значення → явний null: null «після» — теж присутнє значення.
  const nullDesc = { ...makeClient({ id: 'c1', name: 'A' }), description: null };
  const toNull = changeEvent([{
    collection: 'clients', id: 'c1', change: 'update',
    fields: [{ key: 'description', before: 'note', after: null }],
  }]);
  const nullPlan = computeUndoPlan(toNull, snapshotOf({ clients: [nullDesc] }));
  assert.ok(nullPlan.ok, 'явний JSON-null як «після» — валідний стан');
  const backValue = nullPlan.ok && nullPlan.patch.collections!.clients![0] as Record<string, unknown>;
  assert.equal(backValue!.description, 'note');

  // SQL-подія з явними прапорцями: afterExists=false → чекаємо відсутність.
  const sqlStyle = changeEvent([{
    collection: 'clients', id: 'c1', change: 'update',
    fields: [{ key: 'tg', before: '@old', after: null, beforeExists: true, afterExists: false }],
  }]);
  const sqlPlan = computeUndoPlan(sqlStyle, snapshotOf({ clients: [makeClient({ id: 'c1', name: 'A' })] }));
  assert.ok(sqlPlan.ok, 'прапорець afterExists=false: поточний без ключа → ОК');
  const sqlRestored = sqlPlan.ok && sqlPlan.patch.collections!.clients![0] as Record<string, unknown>;
  assert.equal(sqlRestored!.tg, '@old', 'відновлено поле з before');
});

test('undo-plan: явний null після прибирання поля — КОНФЛІКТ, не «відсутність» (регресія P1)', () => {
  // Подія прибрала ключ telegram (afterExists=false). Потім дані змінилися:
  // telegram = null (явне значення). Старий engine прирівнював null до
  // відсутності й дозволяв затерти пізнішу зміну — сервер уже відмовляє,
  // локальний preview/engine має збігатися з ним.
  const before = snapshotOf({ clients: [{ id: 'c1', name: 'Client', telegram: '@old' }] });
  const after = snapshotOf({ clients: [{ id: 'c1', name: 'Client' }] });
  const event = buildEventFromSnapshots(before, after, { source: 'Форма' })!;
  const telegramField = event.changes[0].fields!.find(f => f.key === 'telegram')!;
  assert.equal(telegramField.after, undefined);
  // null у даних можливий попри суворі типи (JSON/legacy-записи) — моделюємо явно.
  const current = snapshotOf({ clients: [{ id: 'c1', name: 'Client', telegram: null } as unknown as Client] });

  const plan = computeUndoPlan(event, current);
  assert.equal(plan.ok, false, 'явний null ≠ відсутній ключ → конфлікт');
  assert.ok(!plan.ok && plan.conflicts.some(c => c.includes('telegram')));
});

test('undo-plan: прибирання поля у налаштуваннях, потім явний null — конфлікт (регресія P1)', () => {
  const before = snapshotOf({});
  const afterSettings = { usdRate: 41, eurRate: 44, displayCurrency: 'UAH' } as DataSnapshot['financeSettings'];
  const after = snapshotOf({ financeSettings: afterSettings });
  const event = buildEventFromSnapshots(before, after, { source: 'Форма' })!;
  const usdtField = event.changes.flatMap(c => c.fields ?? []).find(f => f.key === 'usdtRate')!;
  assert.equal(usdtField.after, undefined, 'подія прибрала usdtRate');
  const current = snapshotOf({ financeSettings: { usdRate: 41, eurRate: 44, usdtRate: null, displayCurrency: 'UAH' } as unknown as DataSnapshot['financeSettings'] });

  const plan = computeUndoPlan(event, current);
  assert.equal(plan.ok, false, 'явний null usdtRate ≠ відсутність → конфлікт');
  // humanizeKey показує підпис «курс USDT» — саме воно в конфлікті.
  assert.ok(!plan.ok && plan.conflicts.some(c => c.includes('курс USDT')));
});

test('undo-plan: позитиви відсутність→відсутність і null→null лишаються дозволеними', () => {
  // відсутній → відсутній: подія прибрала telegram, поточний і без нього.
  const before = snapshotOf({ clients: [{ id: 'c1', name: 'Client', telegram: '@old' }] });
  const after = snapshotOf({ clients: [{ id: 'c1', name: 'Client' }] });
  const event = buildEventFromSnapshots(before, after, { source: 'Форма' })!;
  const planOk = computeUndoPlan(event, snapshotOf({ clients: [{ id: 'c1', name: 'Client' }] }));
  assert.ok(planOk.ok, 'відсутнє «після» + відсутній поточний ключ → дозволено');
  const restored = planOk.ok && planOk.patch.collections!.clients![0] as Record<string, unknown>;
  assert.equal(restored!.telegram, '@old', 'повертається значення «до»');

  // null → null: явне значення null «після» і «до» — дозволено, null повертається.
  const nullEvent = changeEvent([{
    collection: 'clients', id: 'c1', change: 'update',
    fields: [{ key: 'telegram', before: null, after: null, beforeExists: true, afterExists: true }],
  }]);
  const nullPlan = computeUndoPlan(nullEvent, snapshotOf({ clients: [{ id: 'c1', name: 'Client', telegram: null } as unknown as Client] }));
  assert.ok(nullPlan.ok, 'null → null (обидва рази явні) → дозволено');
  const nullRestored = nullPlan.ok && nullPlan.patch.collections!.clients![0] as Record<string, unknown>;
  assert.equal('telegram' in nullRestored!, true, 'ключ зберігається');
  assert.equal(nullRestored!.telegram, null);
});

test('локальний E2E: конфлікт «null замість відсутності» не змінює дані та журнал (preview = сервер)', async () => {
  clearAll();
  await bootStore();
  const project = makeProject({ id: 'p_x', name: 'Проєкт', clientName: 'Клієнт' });
  await store.saveCollection('projectsActive', [project]);
  const saveVia = async (value: unknown[]) => {
    const outcome = await store.atomicAction(async () => {
      const result = await store.saveCollection('projectsActive', value);
      return result.ok ? { ok: true } : { ok: false, errors: [{ message: result.issue.message }] };
    });
    assert.equal(outcome.ok, true);
  };
  // Подія: description додано, потім прибрано → подія прибирання.
  // Вибір — детерміновано за різницею ID операції (не за at/порядком).
  await saveVia([{ ...project, description: 'note' }]);
  const beforeRemove = new Set((await listAll()).map(e => e.id));
  await saveVia([{ ...project }]);
  const removeEvent = (await listAll()).find(
    e => !beforeRemove.has(e.id) && e.action === 'update'
      && e.changes.some(c => (c.fields ?? []).some(f => f.key === 'description' && f.before !== undefined)),
  )!;
  // Пізніша зміна: поле встановлено в явний null.
  await saveVia([{ ...project, description: null } as unknown as Project]);

  const journalBefore = await listAll();
  const snapshotBefore = structuredClone(store.getSnapshot());
  const result = await store.undoHistory({
    eventId: removeEvent.id, requestId: crypto.randomUUID(), source: 'Форма',
  });
  assert.equal(result.ok, false, 'конфлікт: preview той самий engine, що й серверна перевірка');
  assert.equal(result.ok === false && result.reason, 'conflict');
  // Дані й журнал недоторкані; оригінал не позначено.
  assert.equal((store.getSnapshot().projectsActive[0] as unknown as Record<string, unknown>).description, null, 'пізніший null збережено');
  assert.deepEqual(store.getSnapshot(), snapshotBefore, 'snapshot без змін');
  assert.deepEqual(await listAll(), journalBefore, 'журнал без нових подій');
  assert.equal((await listAll()).find(e => e.id === removeEvent.id)!.undoneBy, null, 'подія не позначена');
});

test('локальний undo: відсутнє поле «до» прибирає ключ, а не пише null', async () => {
  clearAll();
  await bootStore();
  const project = makeProject({ id: 'p_d', name: 'Проєкт', clientName: 'Клієнт' });
  await store.saveCollection('projectsActive', [project]);
  const idsNow = async () => new Set((await listAll()).map(e => e.id));
  const saveVia = async (value: unknown[]) => {
    const outcome = await store.atomicAction(async () => {
      const result = await store.saveCollection('projectsActive', value);
      return result.ok ? { ok: true } : { ok: false, errors: [{ message: result.issue.message }] };
    });
    assert.equal(outcome.ok, true);
  };
  // Подія 1: додано description. Вибір — за різницею ID до/після операції.
  const beforeAdd = await idsNow();
  await saveVia([{ ...project, description: 'note' }]);
  const addEvent = (await listAll()).find(
    e => !beforeAdd.has(e.id) && e.changes.some(c => (c.fields ?? []).some(f => f.key === 'description')),
  )!;
  const undoneAdd = await store.undoHistory({ eventId: addEvent.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(undoneAdd.ok, true);
  const afterUndoAdd = store.getSnapshot().projectsActive[0] as unknown as Record<string, unknown>;
  assert.equal('description' in afterUndoAdd, false, 'ключ прибрано, не null');
  // Подія 2/3: додаємо description, потім прибираємо — undo прибирання
  // повертає значення (зміна «значення → відсутність»).
  await saveVia([{ ...project, description: 'note' }]);
  const beforeRemove = await idsNow();
  await saveVia([{ ...project }]);
  // Регресія P2 (нестабільний вибір): кілька подій можуть мати ОДНАКОВИЙ at
  // (мілісекунди) — порядок за at/id випадковий. Вибір події детермінований:
  // новий ID (різниця журналу до/після) + action=update; undo-подія раніше
  // має такий самий description-ключ і без цього фільтру «вигравала» б.
  const stamped = new Date().toISOString();
  const historyRaw = JSON.parse(String(localStorage.getItem('crm_history_v1'))) as { events: { at: string }[] };
  historyRaw.events = historyRaw.events.map(e => ({ ...e, at: stamped }));
  localStorage.setItem('crm_history_v1', JSON.stringify(historyRaw));
  const removeEvent = (await listAll()).find(
    e => !beforeRemove.has(e.id) && e.action === 'update'
      && e.changes.some(c => (c.fields ?? []).some(f => f.key === 'description' && f.before !== undefined)),
  )!;
  assert.equal(removeEvent.action, 'update', 'вибрано саме подію-оновлення, не undo');
  const undoneRemove = await store.undoHistory({ eventId: removeEvent.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(undoneRemove.ok, true);
  assert.equal((store.getSnapshot().projectsActive[0] as unknown as Record<string, unknown>).description, 'note');
  // Стару undo-подію (фаза 1) скасувати не можна — правило не послаблено.
  const undoPhaseOne = (await listAll()).find(e => e.action === 'undo')!;
  const repeat = await store.undoHistory({ eventId: undoPhaseOne.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.ok === false && repeat.reason, 'not_undoable');
});

// ------------------------------------------------------------
// Локальний журнал: реальні доменні дії
// ------------------------------------------------------------

test('журнал: saveProject з клієнтом — одна група (клієнт+проєкт), джерело Форма', async () => {
  clearAll();
  await bootStore();
  const result = await saveProject(makeProject({ name: 'Новий сайт', clientName: 'Новий клієнт' }));
  assert.equal(result.ok, true);
  const events = await listAll();
  assert.equal(events.length, 1, 'одна дія — одна група журналу');
  const event = events[0];
  assert.equal(event.source, 'Форма');
  assert.equal(event.section, 'projects');
  assert.ok(event.changes.some(c => c.collection === 'clients' && c.change === 'create'));
  assert.ok(event.changes.some(c => c.collection === 'projectsActive' && c.change === 'create'));
  assert.equal(isUndoable(event), true);
});

test('журнал: завершення проєкту — подія complete; оплата — payment', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('projectsActive', [makeProject({ id: 'p1', name: 'Проєкт', clientName: 'A' })]);
  assert.equal((await completeProject('p1')).ok, true);
  const payment = await recordProjectPayment('p1', { amount: 1000 });
  assert.equal(payment.ok, true);
  const events = await listAll();
  const complete = events.find(e => e.action === 'complete');
  const paid = events.find(e => e.action === 'payment');
  assert.ok(complete, 'подія завершення');
  assert.ok(paid, 'подія оплати');
  assert.equal(complete!.undoneBy, null);
});

test('журнал: зміна курсів — подія settings; службові meta не журналуються', async () => {
  clearAll();
  await bootStore();
  assert.equal((await saveRates({ usdRate: 40, eurRate: 44 })).ok, true);
  await store.saveMeta({ lastSavedAt: new Date().toISOString() });
  const events = await listAll();
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'settings');
  assert.equal(events[0].section, 'settings');
  assert.ok(events[0].changes.some(c => c.fields!.some(f => f.key === 'usdRate')));
});

test('журнал: невдала дія не залишає події', async () => {
  clearAll();
  await bootStore();
  const result = await saveProject({
    name: 'Поганий', type: 'IT' as const, status: 'Невідомий' as const, startDate: today(),
    budget: 100, currency: 'UAH', clientName: 'Хтось',
  });
  assert.equal(result.ok, false);
  assert.equal((await listAll()).length, 0);
});

test('журнал: AI-дія має джерело Помічник', async () => {
  clearAll();
  await bootStore();
  const result = await applyAssistantPlan({
    domain: 'clients', action: 'create', fields: { name: 'Клієнт з чату' }, base: await fingerprint(store.getSnapshot()),
  } as never);
  assert.equal(result.ok, true);
  const events = await listAll();
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'Помічник');
  assert.equal(events[0].action, 'create');
});

test('журнал: міграції — група «Система» лише після успіху', async () => {
  clearAll();
  await bootStore();
  const project = makeProject() as unknown as Record<string, unknown>;
  project.myIncome = 123;
  await store.saveCollection('projectsActive', [project as never]);
  const report = await migrate();
  assert.equal(report.failed.length, 0);
  const events = await listAll();
  assert.equal(events.length, 1, 'одна група на прогін міграцій');
  assert.equal(events[0].source, 'Система');
});

test('журнал: імпорт даних — групова подія без повного JSON і без скасування', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [makeClient({ id: 'old1', name: 'Старий' })]);
  const incoming = emptySnapshot();
  incoming.clients = [makeClient({ id: 'n1', name: 'Новий 1' }), makeClient({ id: 'n2', name: 'Новий 2' })];
  const report = await applyImport(buildExportPayload(incoming));
  assert.equal(report.ok, true);
  const events = await listAll();
  const importEvent = events.find(e => e.action === 'import');
  assert.ok(importEvent, 'подія імпорту');
  assert.equal(importEvent!.section, 'import');
  assert.equal(isUndoable(importEvent!), false);
  assert.ok(importEvent!.changes.every(c => c.change === 'bulk'), 'лише підсумок');
  // Скасування імпорту відмовляється.
  const undo = await store.undoHistory({ eventId: importEvent!.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(undo.ok, false);
  assert.equal(undo.ok === false && undo.reason, 'not_undoable');
});

test('журнал: події переживають перезапуск сховища', async () => {
  clearAll();
  await bootStore();
  await saveProject(makeProject({ name: 'До перезапуску', clientName: 'Клієнт' }));
  const before = await listAll();
  assert.equal(before.length, 1);
  // Перезапуск: той самий localStorage, нове читання.
  await store.reloadStore();
  const after = await listAll();
  assert.equal(after.length, 1);
  assert.equal(after[0].summary, before[0].summary);
});

// ------------------------------------------------------------
// Скасування (local): E2E
// ------------------------------------------------------------

test('скасування: завершення проєкту відновлюється повністю; повтор — без дубля', async () => {
  clearAll();
  await bootStore();
  const project = makeProject({ id: 'p1', name: 'Проєкт', clientName: 'A' });
  await store.saveCollection('projectsActive', [project]);
  await completeProject('p1');
  const completeEvent = (await listAll()).find(e => e.action === 'complete')!;

  const result = await store.undoHistory({
    eventId: completeEvent.id, requestId: crypto.randomUUID(), source: 'Форма',
  });
  assert.equal(result.ok, true);
  assert.equal(store.getSnapshot().projectsActive.length, 1, 'проєкт повернувся в активні');
  assert.equal(store.getSnapshot().projectsCompleted.length, 0, 'прибрано і завершених');

  const events = await listAll();
  const undoEvent = events.find(e => e.action === 'undo')!;
  assert.ok(undoEvent);
  assert.equal(undoEvent.undoneEventId, completeEvent.id);
  assert.equal(isUndoable(undoEvent), false, 'подію-відновлення не скасовують');
  assert.equal(events.find(e => e.id === completeEvent.id)!.undoneBy, undoEvent.id, 'оригінал позначено');

  // Повторне скасування тієї самої події (новий запит) → відмова.
  const repeat = await store.undoHistory({ eventId: completeEvent.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(repeat.ok, false);
  assert.equal(repeat.ok === false && repeat.reason, 'already_undone');
  // Повтор того самого request ID → ідемпотентний успіх без другої події.
  const again = await store.undoHistory({ eventId: completeEvent.id, requestId: (undoEvent.requestId ?? ''), source: 'Форма' });
  assert.equal(again.ok, true);
  assert.equal((await listAll()).filter(e => e.action === 'undo').length, 1, 'жодного дубля події-відновлення');
});

test('скасування: конфлікт пізнішої зміни не перезаписує дані', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [makeClient({ id: 'c1', name: 'A' })]);
  await saveProject(makeProject({ name: 'Проєкт', clientName: 'A', clientId: 'c1' }));
  const createEvent = (await listAll()).find(e => e.action === 'create' && e.changes.some(c => c.collection === 'projectsActive'))!;
  // Пізніша зміна самого створеного проєкту.
  const projects = store.getSnapshot().projectsActive.map(p => ({ ...p, name: 'Проєкт (оновлено)' }));
  await store.saveCollection('projectsActive', projects);
  // І непов’язана пізніша зміна клієнта — вона має зберегтися.
  const clients = store.getSnapshot().clients.map(c => (c.id === 'c1' ? { ...c, name: 'A (оновлено)' } : c));
  await store.saveCollection('clients', clients);

  const result = await store.undoHistory({
    eventId: createEvent.id, requestId: crypto.randomUUID(), source: 'Форма',
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'conflict');
  assert.ok(result.ok === false && result.conflicts!.some(c => c.includes('змінився після створення')));
  assert.equal(store.getSnapshot().projectsActive[0].name, 'Проєкт (оновлено)', 'створений проєкт не прибрано мовчки');
  assert.equal(store.getSnapshot().clients[0].name, 'A (оновлено)', 'непов’язана пізніша зміна збережена');
});

test('скасування: створення клієнта без залежностей прибирається; залежністю — конфлікт', async () => {
  clearAll();
  await bootStore();
  // Одна подія = створення одного клієнта.
  const solo = await applyAssistantPlan({
    domain: 'clients', action: 'create', fields: { name: 'Самотній' }, base: await fingerprint(store.getSnapshot()),
  } as never);
  assert.equal(solo.ok, true);
  const soloEvent = (await listAll()).find(e => e.changes.some(c => c.collection === 'clients' && c.change === 'create'))!;
  const undone = await store.undoHistory({ eventId: soloEvent.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(undone.ok, true);
  assert.equal(store.getSnapshot().clients.length, 0, 'клієнта-створення прибрано');

  // Група «клієнт + проєкт» створення застосовується атомарно: якщо обидва
  // прибираються разом — зовнішніх залежностей не лишається, і групу можна
  // скасувати цілком (жодної частковості).
  await saveProject(makeProject({ name: 'Залежний проєкт', clientName: 'Залежний' }));
  const groupEvent = (await listAll()).find(
    e => e.action === 'create' && e.id !== soloEvent.id && e.changes.some(c => c.collection === 'clients' && c.change === 'create'),
  )!;
  const grouped = await store.undoHistory({ eventId: groupEvent.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(grouped.ok, true);
  assert.equal(store.getSnapshot().clients.length, 0, 'групу прибрано цілком');
  assert.equal(store.getSnapshot().projectsActive.length, 0, 'без часткового застосування');

  // Залежність пізнішого часу: клієнт створений окремо, проєкт посилається
  // на нього пізніше — прибрати клієнта групою його створення не можна.
  await applyAssistantPlan({
    domain: 'clients', action: 'create', fields: { name: 'Пізніший' }, base: await fingerprint(store.getSnapshot()),
  } as never);
  const laterEvent = (await listAll()).find(
    e => e.action === 'create' && !e.undoneBy && e.changes.some(c => c.collection === 'clients' && c.change === 'create'),
  )!;
  const laterClientId = store.getSnapshot().clients[0].id;
  await saveProject(makeProject({ name: 'Проєкт на пізнього', clientName: 'Пізніший', clientId: laterClientId }));
  const blocked = await store.undoHistory({ eventId: laterEvent.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok === false && blocked.reason, 'conflict');
  assert.equal(store.getSnapshot().projectsActive.length, 1, 'пізніший проєкт не постраждав');
});

test('скасування: AI-чернетка історії виконується з джерелом Помічник', async () => {
  clearAll();
  await bootStore();
  const project = makeProject({ id: 'p1', name: 'Проєкт', clientName: 'A' });
  await store.saveCollection('projectsActive', [project]);
  await completeProject('p1');
  const completeEvent = (await listAll()).find(e => e.action === 'complete')!;

  const result = await applyAssistantPlan({
    domain: 'history', action: 'update', recordId: completeEvent.id, fields: {}, base: 'x',
  } as never);
  assert.equal(result.ok, true);
  assert.equal(store.getSnapshot().projectsActive.length, 1);
  const undoEvent = (await listAll()).find(e => e.action === 'undo')!;
  assert.equal(undoEvent.source, 'Помічник', 'автор/джерело визначає система, не модель');
});

// ------------------------------------------------------------
// Recovery-мітка та чесні повідомлення про збій журналу
// ------------------------------------------------------------

test('збій запису журналу: дані збережені, подію дописано з recovery-мітки', async () => {
  clearAll();
  await bootStore();
  const originalSet = localStorage.setItem.bind(localStorage);
  let breakHistory = true;
  (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = (key: string, value: string) => {
    if (breakHistory && String(key) === 'crm_history_v1') {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    return originalSet(key, value);
  };
  try {
    const result = await saveProject(makeProject({ name: 'З фейлом журналу', clientName: 'Клієнт' }));
    assert.equal(result.ok, true, 'дані збережено попри збій журналу');
    assert.equal(store.getSnapshot().projectsActive.length, 1);
    // Подія не записалась, але мітка відновлення лишилася.
    const pending = localStorage.getItem('crm_history_pending_v1');
    assert.ok(pending && JSON.parse(pending).id, 'recovery-мітка містить подію');
    assert.equal((await listAll()).length, 0, 'до відновлення журнал порожній');
  } finally {
    (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = originalSet;
  }
  // Після зняття збою наступне читання дописує подію з мітки.
  const recovered = await listAll();
  assert.equal(recovered.length, 1, 'подію дописано з recovery-мітки');
  assert.equal(recovered[0].summary.includes('З фейлом журналу') || recovered[0].changes.length > 0, true);
});

// ------------------------------------------------------------
// Локальний rollback: чесні гарантії (зауваження першого огляду)
// ------------------------------------------------------------

test('rollback: невдалий другий запис → відкочування ПЕРЕВІРЕНО, без інциденту', async () => {
  clearAll();
  await bootStore();
  const project = makeProject({ id: 'p1', name: 'Проєкт', clientName: 'A' });
  await store.saveCollection('projectsActive', [project]);
  await completeProject('p1');
  const completeEvent = (await listAll()).find(e => e.action === 'complete')!;

  const originalSet = localStorage.setItem.bind(localStorage);
  (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = (key: string, value: string) => {
    if (String(key) === 'projects_completed') {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    return originalSet(key, value);
  };
  try {
    const result = await store.undoHistory({ eventId: completeEvent.id, requestId: crypto.randomUUID(), source: 'Форма' });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.message.includes('ПЕРЕВІРЕНО'), 'відкат підтверджено повторним читанням');
  } finally {
    (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = originalSet;
  }
  assert.equal(localStorage.getItem('crm_undo_incomplete_v1'), null, 'без інциденту після підтвердженого відкату');
  assert.equal(store.getSnapshot().projectsCompleted.length, 1, 'стан даних як до спроби (відкат успішний)');
});

test('rollback: збій відкочування → стійкий інцидент блокує запис до перевірки', async () => {
  clearAll();
  await bootStore();
  const project = makeProject({ id: 'p1', name: 'Проєкт', clientName: 'A' });
  await store.saveCollection('projectsActive', [project]);
  await completeProject('p1');
  const completeEvent = (await listAll()).find(e => e.action === 'complete')!;

  const originalSet = localStorage.setItem.bind(localStorage);
  let activeWrites = 0;
  (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = (key: string, value: string) => {
    const k = String(key);
    if (k === 'projects_active') {
      activeWrites += 1;
      // Перший запис даних дозволений; спроба відкочування (друга) — ні.
      if (activeWrites > 1) throw new Error('QuotaExceededError');
    }
    if (k === 'projects_completed') {
      // Мітка інциденту має існувати ДО першого запису даних.
      assert.ok(localStorage.getItem('crm_undo_incomplete_v1'), 'мітка пишеться до записів даних');
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    return originalSet(key, value);
  };
  try {
    const result = await store.undoHistory({ eventId: completeEvent.id, requestId: crypto.randomUUID(), source: 'Форма' });
    assert.equal(result.ok, false);
    assert.ok(result.ok === false && result.message.includes('НЕ підтверджено'), 'не заявляємо про відкат без доказу');
    assert.ok(result.ok === false && result.message.includes('віднови з резервної копії'), 'чесна інструкція для власника');
  } finally {
    (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = originalSet;
  }
  // Стійкий інцидент: мітка + блок запису, переживає перезапуск сховища.
  assert.ok(localStorage.getItem('crm_undo_incomplete_v1'), 'мітка невдалого скасування переживає збій');
  assert.ok(store.getWriteBlock(), 'запис заблоковано');
  const blocked = await store.saveCollection('clients', [makeClient({ name: 'Не можна' })]);
  assert.equal(blocked.ok, false, 'нові дії блокуються до перевірки');
  await store.initStore(new LocalDataSource());
  assert.ok(store.getWriteBlock(), 'перезапуск не втрачає інцидент');
  // Після явної перевірки/прибирання мітки запис можливий.
  localStorage.removeItem('crm_undo_incomplete_v1');
  await store.initStore(new LocalDataSource());
  assert.equal(store.getWriteBlock(), null);
});

test('журнал: збій запису події після успішної дії — issue видимий і підписники сповіщені', async () => {
  clearAll();
  await bootStore();
  let notified = 0;
  const unsubscribe = store.subscribe(() => { notified += 1; });
  const originalSet = localStorage.setItem.bind(localStorage);
  (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = (key: string, value: string) => {
    if (String(key) === 'crm_history_v1') {
      const err = new Error('QuotaExceededError');
      err.name = 'QuotaExceededError';
      throw err;
    }
    return originalSet(key, value);
  };
  try {
    const result = await saveProject(makeProject({ name: 'Дія зі збоєм журналу', clientName: 'Клієнт' }));
    assert.equal(result.ok, true, 'основна дія успішна');
  } finally {
    (localStorage as unknown as { setItem: (k: string, v: string) => void }).setItem = originalSet;
    unsubscribe();
  }
  assert.ok(notified > 0, 'підписники сповіщені про збій журналу');
  assert.ok(
    store.getIssues().some(i => i.key === 'crm_history_v1' && i.kind === 'write_failed'),
    'issue журналу видимий у списку проблем',
  );
});

// ------------------------------------------------------------
// Контракт віддаленого адаптера (НЕ перевірка SQL)
// ------------------------------------------------------------

function fakeRpcDb() {
  let snap = emptySnapshot(), revision = 0, commits = 0;
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  let missingHistory = false;
  let undoError: { message: string; code?: string } | null = null;
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name === 'crm_read') return { data: { revision, snapshot: structuredClone(snap) }, error: null };
    if (name === 'crm_commit') {
      const hasSource = args && 'p_source' in args;
      if (hasSource && missingHistory) {
        return { data: null, error: { message: 'Could not find the function public.crm_commit(...)', code: 'PGRST202' } };
      }
      commits++;
      if (args?.p_revision !== revision) return { data: null, error: { message: 'CRM_CONFLICT' } };
      snap = structuredClone(args!.p_snapshot as typeof snap);
      return { data: ++revision, error: null };
    }
    if (name === 'crm_history_list') {
      if (missingHistory) return { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } };
      return { data: { events: [], total: 0 }, error: null };
    }
    if (name === 'crm_history_get') {
      if (missingHistory) return { data: null, error: { message: 'Could not find the function', code: 'PGRST202' } };
      return { data: null, error: null };
    }
    if (name === 'crm_history_undo') {
      if (undoError) return { data: null, error: undoError };
      return { data: { eventId: 'evt-1', revision: revision + 1, duplicate: false }, error: null };
    }
    return { data: null, error: { message: 'unknown rpc' } };
  };
  return {
    rpc, calls, get commits() { return commits; },
    set missingHistory(v: boolean) { missingHistory = v; },
    set undoError(v: { message: string; code?: string } | null) { undoError = v; },
  };
}

test('remote-контракт: commit передає джерело/дію та відкатується до старої сигнатури без міграції', async () => {
  clearAll();
  const db = fakeRpcDb();
  const source = new SupabaseDataSource(db.rpc);
  await store.initStore(source);
  await runWithWriteContext({ source: 'Помічник', hint: null }, async () => {
    assert.equal((await store.saveCollection('clients', [makeClient({ name: 'A' })])).ok, true);
  });
  const commitCall = db.calls.filter(c => c.name === 'crm_commit');
  assert.ok(commitCall.length >= 1);
  assert.equal(commitCall[0].args!.p_source, 'Помічник');
  assert.ok('p_action' in commitCall[0].args!);

  // Без міграції 003: перший виклик відхилено (PGRST202) → повтор 3-аргументним.
  db.missingHistory = true;
  const commitsBefore = db.commits;
  assert.equal((await store.saveCollection('clients', [makeClient({ name: 'B' })])).ok, true);
  const after = db.calls.filter(c => c.name === 'crm_commit').slice(-2);
  assert.equal(after.length, 2, 'є fallback-виклик');
  assert.ok(!('p_source' in after[1].args!), 'резервна стара сигнатура без журналу');
  assert.equal(db.commits, commitsBefore + 1, 'запис даних не постраждав');
});

test('remote-контракт: список/подія/скасування викликають правильні rpc, помилки мапляться', async () => {
  clearAll();
  const db = fakeRpcDb();
  const source = new SupabaseDataSource(db.rpc);
  await store.initStore(source);

  await source.historyList({ limit: 5, offset: 10, section: 'projects', action: 'update', from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' });
  const listCall = db.calls.find(c => c.name === 'crm_history_list')!;
  assert.equal(listCall.args!.p_limit, 5);
  assert.equal(listCall.args!.p_offset, 10);
  assert.equal(listCall.args!.p_section, 'projects');
  assert.equal(listCall.args!.p_action, 'update');

  db.missingHistory = true;
  await assert.rejects(() => source.historyList({ limit: 1 }), /003-history/);
  await assert.rejects(() => source.historyGet('x'), /003-history/);
  db.missingHistory = false;

  db.undoError = { message: 'CRM_CONFLICT' };
  const conflict = await source.historyUndo({ eventId: 'e1', requestId: 'r1', source: 'Форма', patch: {} as never });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok === false && conflict.reason, 'conflict');

  db.undoError = { message: 'CRM_UNDO_CHANGED' };
  const changed = await source.historyUndo({ eventId: 'e1', requestId: 'r1', source: 'Форма', patch: {} as never });
  assert.equal(changed.ok === false && changed.reason, 'conflict', 'стан не відповідає «після» → конфлікт');

  db.undoError = { message: 'CRM_UNDO_DEPENDENCY' };
  const dependency = await source.historyUndo({ eventId: 'e1', requestId: 'r1', source: 'Форма', patch: {} as never });
  assert.equal(dependency.ok === false && dependency.reason, 'conflict', 'залежності → конфлікт');

  db.undoError = { message: 'CRM_ALREADY_UNDONE' };
  const twice = await source.historyUndo({ eventId: 'e1', requestId: 'r1', source: 'Форма', patch: {} as never });
  assert.equal(twice.ok === false && twice.reason, 'already_undone');

  db.undoError = null;
  const undoCallArgs = { eventId: 'e1', requestId: 'r2', source: 'Форма' as const, expectedRevision: 7, patch: { collections: { clients: [] } } };
  const okResult = await source.historyUndo(undoCallArgs);
  assert.equal(okResult.ok, true);
  const call = db.calls.filter(c => c.name === 'crm_history_undo').at(-1)!;
  assert.equal(call.args!.p_event_id, 'e1');
  assert.equal(call.args!.p_request, 'r2');
  assert.equal(call.args!.p_expected_revision, 7);
  assert.equal(call.args!.p_source, 'Форма');
  // Ревізія 2 (P1.5/P1.7): клієнт більше НЕ передає патч — сервер сам
  // обчислює інверсію; ревізія обов'язкова.
  assert.equal('p_patch' in call.args!, false, 'патч не передається — інверсію рахує сервер');
});

// ------------------------------------------------------------
// AI: normalizePlan для domain history
// ------------------------------------------------------------

test('AI: domain history приймає лише update з recordId і без полів', () => {
  const s = emptySnapshot();
  const normalized = normalizePlan({ domain: 'history', action: 'update', recordId: 'evt-1', fields: {} }, s);
  assert.equal(normalized.domain, 'history');
  assert.equal(normalized.recordId, 'evt-1');
  assert.throws(() => normalizePlan({ domain: 'history', action: 'create', fields: {} }, s), /скасування/);
  assert.throws(() => normalizePlan({ domain: 'history', action: 'update', fields: {} }, s), /recordId|ID події/);
  assert.throws(() => normalizePlan({ domain: 'history', action: 'update', recordId: 'e', fields: { name: 'x' } }, s), /Непідтримуване поле/);
});

// ------------------------------------------------------------
// Імпортована історія (недовіра) та експорт
// ------------------------------------------------------------

test('імпортована історія: валідація, недовіра, секрети; експорт — окремий файл', () => {
  clearImportedHistory();
  assert.equal(importHistoryPayload({ hello: 'world' }).ok, false);
  const file = {
    app: 'CRM history export', version: 1, exportedAt: new Date().toISOString(),
    events: [
      {
        id: 'imp1', at: new Date().toISOString(), section: 'clients', action: 'create', source: 'Форма',
        summary: 'Старе', changes: [{ collection: 'clients', id: 'c1', change: 'create', after: { id: 'c1', name: 'A', apiKey: 'sk-imp' } }],
      },
      { id: 'broken' },
    ],
  };
  const result = importHistoryPayload(file);
  assert.ok(result.ok);
  const imported = readImportedHistory();
  assert.equal(imported.length, 1, 'непридатні події відкинуто');
  assert.equal(imported[0].imported, true);
  assert.equal(isUndoable(imported[0]), false, 'імпортована подія без права скасування');
  assert.equal(JSON.stringify(imported).includes('sk-imp'), false);
  // Експорт: окремий payload, секретів немає.
  const exportPayload = buildHistoryExport(imported);
  assert.equal(exportPayload.app, 'CRM history export');
  assert.equal(JSON.stringify(exportPayload).includes('sk-imp'), false);
  // Основний експорт даних не містить журналу.
  const dataExport = JSON.stringify(buildExportPayload(emptySnapshot()));
  assert.equal(dataExport.includes('imp1'), false);
  clearImportedHistory();
  assert.equal(readImportedHistory().length, 0);
});

// ------------------------------------------------------------
// Вимір обсягу журналу на синтетичній серії
// ------------------------------------------------------------

test('розмір: синтетична серія змін — виміряний приріст на подію', async () => {
  clearAll();
  await bootStore();
  const client = makeClient({ id: 'c_size', name: 'Клієнт розміру' });
  await store.saveCollection('clients', [client]);
  for (let i = 0; i < 200; i++) {
    await store.atomicAction(async () => {
      const outcome = await store.saveCollection('clients', [{ ...client, name: `Клієнт розміру ${i}` }]);
      return outcome.ok ? { ok: true } : { ok: false, errors: [{ message: outcome.issue.message }] };
    });
  }
  const events = await listAll();
  assert.equal(events.length, 200);
  const bytes = JSON.stringify(events).length;
  const average = Math.round(bytes / events.length);
  // Документований орієнтир: подія оновлення одного запису ≪ 1 КБ JSON.
  assert.ok(average < 1024, `середній розмір події ${average} Б`);
  // eslint-disable-next-line no-console
  console.log(`[history-size] подій: ${events.length}, разом: ${bytes} Б, середній: ${average} Б/подію`);
});

// ------------------------------------------------------------
// Контекст запису
// ------------------------------------------------------------

test('контекст запису: вкладені виклики відновлюють попереднє джерело', async () => {
  resetWriteContext();
  assert.equal(getWriteContext().source, 'Форма');
  await runWithWriteContext({ source: 'Помічник' }, async () => {
    assert.equal(getWriteContext().source, 'Помічник');
    await runWithWriteContext({ source: 'Система' }, async () => {
      assert.equal(getWriteContext().source, 'Система');
    });
    assert.equal(getWriteContext().source, 'Помічник', 'після вкладеного — попереднє');
  });
  assert.equal(getWriteContext().source, 'Форма');
  resetWriteContext();
});

// ------------------------------------------------------------
// Дрібниці: deepEqual/patchSnapshot/buildEvent примусові мітки
// ------------------------------------------------------------

test('engine: deepEqual і patchSnapshot коректні', () => {
  assert.equal(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true);
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false);
  assert.equal(deepEqual(null, {}), false);
  const snap = snapshotOf({ clients: [makeClient({ id: 'c1' })] });
  const patched = patchSnapshot(snap, { collections: { clients: [] } });
  assert.equal(patched.clients.length, 0);
  assert.equal(snap.clients.length, 1, 'вихідний snapshot не мутується');
});

test('engine: buildEvent з примусовими мітками (відновлення) і порівняння часткових станів', () => {
  const event = buildEvent({
    before: { clients: [makeClient({ id: 'c1', name: 'Після' })] },
    after: { clients: [] },
    ctx: { source: 'Форма' },
    forced: {
      action: 'undo', section: 'clients', undoneEventId: 'orig', summary: 'Скасовано: «тест»',
      requestId: 'req-1',
    },
  })!;
  assert.ok(event);
  assert.equal(event.action, 'undo');
  assert.equal(event.undoneEventId, 'orig');
  assert.equal(event.requestId, 'req-1');
  assert.equal(event.summary, 'Скасовано: «тест»');
  assert.equal(event.changes[0].change, 'delete');
  // Порівняння лише переданих ключів: незмінені колекції не створюють подій.
  const same = makeClient({ id: 'c1' });
  const noop = buildEvent({ before: { clients: [same] }, after: { clients: [same] }, ctx: { source: 'Форма' } });
  assert.equal(noop, null);
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
