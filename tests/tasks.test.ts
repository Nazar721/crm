import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  browserNotificationsSupported, dueReminders, filterTasks, inAppRemindersEnabled,
  isReminderDue, reminderIdsToMark, setInAppRemindersEnabled, snoozeReminderIso,
  taskCounts, taskDateTimeFields, taskSchedule, validateTaskInput,
} from '@/lib/tasks';
import { kyivDateTimeToIso } from '@/lib/dates';
import {
  applyAssistantPlan, cancelTask, completeTask, markRemindersShown, saveTask, saveRates, snoozeTaskReminder,
} from '@/lib/actions';
import { fingerprint, missingQuestions, modelContext, normalizePlan } from '@/lib/assistant/plan';
import { dashboardStats } from '@/lib/calc';
import { buildExportPayload } from '@/lib/export';
import { applyImport } from '@/lib/importer';
import { validateBackup } from '@/lib/validate-backup';
import * as store from '@/lib/store';
import { clearAll, bootStore, emptySnapshot } from './helpers';
import type { Task } from '@/types';

// ============================================================
// Пакет 05 (+ спільні перевірки 06): завдання, нагадування,
// журнал/скасування, імпорт, AI. Синтетичні дані.
// ============================================================

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk1', title: 'Написати клієнту', priority: 'normal', status: 'planned', ...overrides,
  };
}

// ------------------------------------------------------------
// Kyiv: календарний момент → однозначний інстант
// ------------------------------------------------------------

test('kyivDateTimeToIso: зимовий/літній зсув і некоректні значення', () => {
  const winter = kyivDateTimeToIso('2026-01-15', '10:00');
  assert.ok(winter?.endsWith('T08:00:00.000Z'), `зима Kyiv = UTC+2: ${winter}`);
  const summer = kyivDateTimeToIso('2026-07-15', '10:00');
  assert.ok(summer?.endsWith('T07:00:00.000Z'), `літо Kyiv = UTC+3: ${summer}`);
  assert.equal(kyivDateTimeToIso('2026-13-40', '10:00'), null);
  assert.equal(kyivDateTimeToIso('не дата', '10:00'), null);
  // Валідність годинника (HH:MM < 24) контролює validateTaskTime на вході.
});

test('розклад: день без часу прострочується наступного дня; з часом — за моментом', () => {
  const now = new Date('2026-10-13T09:00:00Z'); // 12:00 Kyiv восени (UTC+3)
  // Без дедлайну — ніколи не прострочене
  assert.equal(taskSchedule(task(), now).bucket, 'future');
  assert.equal(taskSchedule(task(), now).overdue, false);
  // День без часу
  assert.equal(taskSchedule(task({ dueDate: '2026-10-12' }), now).overdue, true, 'вчора → прострочено з наступного дня');
  assert.equal(taskSchedule(task({ dueDate: '2026-10-12' }), now).bucket, 'overdue');
  assert.equal(taskSchedule(task({ dueDate: '2026-10-13' }), now).bucket, 'today', 'сьогоднішній день без часу ще триває');
  assert.equal(taskSchedule(task({ dueDate: '2026-10-13' }), now).overdue, false);
  assert.equal(taskSchedule(task({ dueDate: '2026-10-20' }), now).bucket, 'future');
  // З часом: хвилина до / момент / після (Kyiv 2026-10-13 15:00 = 12:00Z)
  assert.equal(taskSchedule(task({ dueDate: '2026-10-13', dueTime: '15:00' }), new Date('2026-10-13T11:59:00Z')).overdue, false);
  assert.equal(taskSchedule(task({ dueDate: '2026-10-13', dueTime: '15:00' }), new Date('2026-10-13T12:00:00Z')).overdue, false, 'момент дедлайну ще не минув');
  assert.equal(taskSchedule(task({ dueDate: '2026-10-13', dueTime: '15:00' }), new Date('2026-10-13T12:01:00Z')).overdue, true, 'хвилина після → прострочено');
  // Стани переважають
  assert.equal(taskSchedule(task({ status: 'done', dueDate: '2020-01-01' }), now).bucket, 'done');
  assert.equal(taskSchedule(task({ status: 'cancelled', dueDate: '2020-01-01' }), now).bucket, 'cancelled');
});

test('нагадування: настане лише для планованих із минулим моментом; захист від повтору', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const past = task({ reminderAt: '2026-10-13T09:00:00.000Z' });
  assert.equal(isReminderDue(past, now), true);
  assert.equal(isReminderDue({ ...past, reminderShownAt: '2026-10-13T09:00:05.000Z' }, now), false, 'показане не показується повторно');
  assert.equal(isReminderDue({ ...past, status: 'done' }, now), false, 'виконане не нагадує');
  assert.equal(isReminderDue({ ...past, status: 'cancelled' }, now), false);
  assert.equal(isReminderDue(task({ reminderAt: '2026-10-13T23:00:00.000Z' }), now), false, 'майбутній момент ще не настав');
  assert.deepEqual(reminderIdsToMark([past, task({ reminderAt: '2026-10-13T23:00:00.000Z' })], now), ['tsk1']);
});

test('фільтри вкладок/пошук/пріоритет і підсумки', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const tasks = [
    task({ id: 'a', title: 'Прострочене', dueDate: '2026-10-01' }),
    task({ id: 'b', title: 'Сьогоднішнє', dueDate: '2026-10-13' }),
    task({ id: 'c', title: 'Майбутнє', dueDate: '2026-11-01', priority: 'high' }),
    task({ id: 'd', title: 'Без строку і клієнта' }),
    task({ id: 'e', title: 'Виконане', status: 'done', dueDate: '2026-10-01' }),
  ];
  assert.deepEqual(filterTasks(tasks, { tab: 'overdue', now }).map(x => x.task.id), ['a']);
  assert.deepEqual(filterTasks(tasks, { tab: 'today', now }).map(x => x.task.id), ['b']);
  assert.deepEqual(filterTasks(tasks, { tab: 'future', now }).map(x => x.task.id).sort(), ['c', 'd'], 'без строку — в майбутніх');
  assert.deepEqual(filterTasks(tasks, { tab: 'finished', now }).map(x => x.task.id), ['e']);
  assert.equal(filterTasks(tasks, { tab: 'future', query: 'клієнта', now }).length, 1, 'пошук за текстом');
  assert.equal(filterTasks(tasks, { tab: 'future', priority: 'high', now })[0].task.id, 'c');
  assert.deepEqual(taskCounts(tasks, now), { today: 1, future: 2, overdue: 1, finished: 1, dueReminders: 0 });
});

test('нормалізація дат: нагадування лише за явної дати й часу', () => {
  assert.deepEqual(taskDateTimeFields({ dueDate: '2026-10-20' }), { dueDate: '2026-10-20' }, 'дедлайн без часу ок');
  assert.deepEqual(taskDateTimeFields({ dueDate: '2026-10-20', dueTime: '09:30', reminderDate: '2026-10-19', reminderTime: '10:00' }),
    { dueDate: '2026-10-20', dueTime: '09:30', reminderAt: kyivDateTimeToIso('2026-10-19', '10:00')! });
  assert.deepEqual(taskDateTimeFields({ reminderDate: '2026-10-19' }), {}, 'нагадування без часу не вигадується');
  assert.equal(snoozeReminderIso('2026-10-01', '10:00', new Date('2026-10-13T12:00:00Z')), null, 'перенесення лише в майбутнє');
  assert.ok(snoozeReminderIso('2026-10-14', '10:00', new Date('2026-10-13T12:00:00Z')));
  assert.deepEqual(validateTaskInput({ title: '' }).map(e => e.field), ['title']);
  assert.equal(validateTaskInput({ title: 'OK', priority: 'urgent' as never }).some(e => e.field === 'priority'), true);
});

// ------------------------------------------------------------
// Дії: CRUD, статуси, нагадування; без фінансових транзакцій
// ------------------------------------------------------------

test('дії: створення/редагування/виконання/скасування без транзакцій «Фінансів»', async () => {
  clearAll();
  await bootStore();
  const created = await saveTask({ title: 'Оплатити рахунок', priority: 'high', dueDate: '2026-10-20' });
  assert.equal(created.ok, true);
  assert.equal(store.getSnapshot().tasks.length, 1);
  assert.equal(store.getSnapshot().transactions.length, 0, 'виконання/створення завдання «оплатити» не робить транзакцій');
  const id = store.getSnapshot().tasks[0].id;
  // Виконання двічі — без дубліката/змін
  assert.equal((await completeTask(id)).ok, true);
  const afterFirst = store.getSnapshot().tasks[0];
  assert.equal((await completeTask(id)).ok, true);
  assert.deepEqual(store.getSnapshot().tasks[0], afterFirst, 'повторне виконання ідемпотентне');
  assert.ok(afterFirst.completedAt);
  // Повернення в плановані та скасування
  const reopened = await saveTask({ status: 'planned' }, id);
  assert.equal(reopened.ok, true);
  assert.equal(store.getSnapshot().tasks[0].status, 'planned');
  assert.equal((await cancelTask(id)).ok, true);
  assert.equal(store.getSnapshot().tasks[0].status, 'cancelled');
  assert.equal((await cancelTask('ghost')).ok, false);
  // Редагування назви не чіпає нагадування
  await saveTask({ title: 'Нова назва' }, id);
  assert.equal(store.getSnapshot().tasks[0].title, 'Нова назва');
});

test('дії: нагадування — лише явна дата+час; перенесення не змінює дедлайн', async () => {
  clearAll();
  await bootStore();
  await saveTask({ title: 'З нагадуванням', reminderDate: '2026-01-19', reminderTime: '10:00', dueDate: '2026-10-20' });
  const t = store.getSnapshot().tasks[0];
  assert.equal(t.reminderAt, kyivDateTimeToIso('2026-01-19', '10:00'));
  assert.equal(t.dueDate, '2026-10-20');
  // Без часу нагадування не створюється
  await saveTask({ title: 'Без часу', reminderDate: '2026-10-19' });
  assert.equal(store.getSnapshot().tasks[1].reminderAt, undefined);
  // Перенесення: дедлайн не змінюється; показ скидається
  await markRemindersShown([t.id]);
  assert.ok(store.getSnapshot().tasks[0].reminderShownAt, 'позначку показу збережено');
  const snoozed = await snoozeTaskReminder(t.id, '2026-10-19', '18:00');
  assert.equal(snoozed.ok, true);
  const after = store.getSnapshot().tasks.find(x => x.id === t.id)!;
  assert.equal(after.reminderAt, kyivDateTimeToIso('2026-10-19', '18:00'));
  assert.equal(after.dueDate, '2026-10-20', 'дедлайн не змінився мовчки');
  assert.equal(after.reminderShownAt, undefined, 'перенесення скидає показ');
  assert.equal((await snoozeTaskReminder(t.id, '2026-10-01', '10:00')).ok, false, 'минулий момент — відмова');
  // Прибирання нагадування — явне
  await saveTask({ reminderClear: true } as never, t.id);
  assert.equal(store.getSnapshot().tasks.find(x => x.id === t.id)!.reminderAt, undefined);
});

test('дії: показ нагадувань — групова позначка без повторів; перезапуск зберігає захист', async () => {
  clearAll();
  await bootStore();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 86400000).toISOString().slice(0, 10);
  await saveTask({ title: 'Одне', reminderDate: yesterday, reminderTime: '08:00' });
  await saveTask({ title: 'Друге', reminderDate: yesterday, reminderTime: '09:00' });
  await saveTask({ title: 'Майбутнє', reminderDate: tomorrow, reminderTime: '10:00' });
  assert.equal(dueReminders(store.getSnapshot().tasks, now).length, 2);
  const ids = reminderIdsToMark(store.getSnapshot().tasks, now);
  assert.equal((await markRemindersShown(ids)).ok, true);
  assert.equal(dueReminders(store.getSnapshot().tasks, new Date()).length, 0, 'після позначки — без повторного показу');
  assert.equal((await markRemindersShown(ids)).ok, true, 'повторна позначка без змін — без помилки');
  // Перезапуск: захист від повтору переживає перечитування
  await store.reloadStore();
  assert.equal(dueReminders(store.getSnapshot().tasks, new Date()).length, 0, 'після перезапуску не нагадує знову');
});

test('журнал: події завдань — групи; скасування виконання відновлює статус', async () => {
  clearAll();
  await bootStore();
  await saveTask({ title: 'Завдання в журналі' });
  const id = store.getSnapshot().tasks[0].id;
  await completeTask(id);
  const events = await store.listHistory({ limit: 50 });
  const createEvent = events.events.find(e => e.action === 'create' && e.changes.some(c => c.collection === 'tasks'));
  const doneEvent = events.events.find(e => e.changes.some(c => c.collection === 'tasks' && (c.fields ?? []).some(f => f.key === 'status')));
  assert.ok(createEvent, 'подія створення');
  assert.ok(doneEvent, 'подія виконання');
  assert.equal(createEvent!.section, 'tasks');
  const undone = await store.undoHistory({ eventId: doneEvent!.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(undone.ok, true);
  assert.equal(store.getSnapshot().tasks[0].status, 'planned', 'виконання скасовано через журнал');
});

test('імпорт: v3-файл без tasks не стирає наявні завдання; явний порожній масив — перезаписує', async () => {
  clearAll();
  await bootStore();
  await saveTask({ title: 'Наявне завдання' });
  const legacy = JSON.parse(JSON.stringify(buildExportPayload(emptySnapshot())));
  legacy.version = 3;
  delete legacy.data.tasks; // файл від 04-пакета без завдань
  const validation = validateBackup(legacy);
  assert.equal(validation.ok, true);
  assert.ok(validation.missing.includes('tasks'));
  const report = await applyImport(legacy);
  assert.equal(report.ok, true);
  assert.equal(store.getSnapshot().tasks.length, 1, 'завдання збережено');
  assert.ok((report.kept ?? []).includes('tasks'));
  // Явний порожній масив v3 → перезапис
  const emptyV3 = buildExportPayload(emptySnapshot());
  const wipe = await applyImport(emptyV3);
  assert.equal(wipe.ok, true);
  assert.equal(store.getSnapshot().tasks.length, 0);
});

// ------------------------------------------------------------
// AI: домен tasks
// ------------------------------------------------------------

test('AI: обов’язкова назва, дефолти, відмова видалення, контекст', async () => {
  const s = { ...emptySnapshot(), tasks: [task()] };
  const planNoTitle = normalizePlan({ domain: 'tasks', action: 'create', fields: { priority: 'high' } }, s);
  assert.deepEqual(missingQuestions(planNoTitle, s).map(q => q.key), ['title']);
  const plan = normalizePlan(
    { domain: 'tasks', action: 'create', fields: { title: 'Нове', reminderDate: '2026-10-19', reminderTime: '10:00' } },
    s,
  );
  assert.equal(plan.fields.priority, 'normal');
  assert.equal(plan.fields.status, 'planned');
  assert.throws(() => normalizePlan({ domain: 'tasks', action: 'delete', recordId: 'tsk1', fields: {} }, s), /cancelled/);
  const context = modelContext(s) as unknown as { tasks: { id: string; bucket: string }[] };
  assert.equal(context.tasks.length, 1);
  assert.ok(context.tasks[0].bucket, 'готовий стан у контексті');
  await clearAll();
  await bootStore();
  // Ланцюжок: уточнення → чернетка → підтвердження → одна зміна → журнал
  const first = normalizePlan({ domain: 'tasks', action: 'create', fields: {} }, store.getSnapshot());
  assert.ok(missingQuestions(first, store.getSnapshot()).length > 0, 'без назви — уточнення');
  const draft = normalizePlan(
    { domain: 'tasks', action: 'create', fields: { title: 'З чату', priority: 'high', dueDate: '2026-10-25' } },
    store.getSnapshot(),
  );
  const applied = await applyAssistantPlan({ ...draft, base: await fingerprint(store.getSnapshot()) } as never);
  assert.equal(applied.ok, true);
  assert.equal(store.getSnapshot().tasks.length, 1);
  assert.equal(store.getSnapshot().tasks[0].title, 'З чату');
  const events = await store.listHistory({ limit: 20 });
  assert.equal(events.events.filter(e => e.changes.some(c => c.collection === 'tasks')).length, 1, 'одна фактична зміна → одна група');
  // Повторне підтвердження тієї ж чернетки → без дубліката
  const repeat = await applyAssistantPlan({ ...draft, base: 'stale' } as never);
  assert.equal(repeat.ok, false);
  assert.equal(store.getSnapshot().tasks.length, 1);
});

// ------------------------------------------------------------
// 06: спільні перевірки
// ------------------------------------------------------------

test('06: фінансові підсумки не змінюються від завдань і хостингу', async () => {
  clearAll();
  await bootStore();
  await saveRates({ usdRate: 41, eurRate: 44 });
  const before = dashboardStats(store.getSnapshot());
  await saveTask({ title: 'Завдання без фінансів', dueDate: '2026-10-20' });
  const taskId = store.getSnapshot().tasks[0].id;
  await completeTask(taskId);
  await store.saveCollection('hostingServices', [{ id: 'hsx', name: 'Хостинг', currency: 'UAH' }]);
  await store.saveCollection('hostingPayments', [{ id: 'hpx', serviceId: 'hsx', date: '2026-10-01', amount: 100, currency: 'UAH', periodStart: '2026-10-01', periodEnd: '2026-11-01' }]);
  const after = dashboardStats(store.getSnapshot());
  assert.deepEqual(after, before, 'жодних фінансових змін від завдань/хостингу');
});

test('06: перфо-димір фільтрів і контексту на синтетичних наборах (без заяв про прискорення)', async () => {
  clearAll();
  await bootStore();
  const make = (n: number): Task[] => Array.from({ length: n }, (_, i) => task({
    id: `t${i}`, title: `Завдання ${i}`, dueDate: i % 3 === 0 ? '2026-10-01' : i % 3 === 1 ? '2026-10-13' : '2026-12-01',
    priority: i % 2 ? 'high' : 'low',
  }));
  const now = new Date();
  const t1 = performance.now();
  filterTasks(make(1_000), { tab: 'overdue', now });
  const ms1 = performance.now() - t1;
  const t2 = performance.now();
  filterTasks(make(20_000), { tab: 'today', priority: 'high', now });
  const ms2 = performance.now() - t2;
  // eslint-disable-next-line no-console
  console.log(`[perf] filter 1k=${ms1.toFixed(1)}ms, 20k+фільтр=${ms2.toFixed(1)}ms`);
  assert.ok(ms2 < 2000, `фільтрація 20k завдань ${ms2.toFixed(1)}ms — в межах бюджету інтерактиву`);
  const big = emptySnapshot();
  big.tasks = make(10_000);
  const t3 = performance.now();
  const context = modelContext(big) as unknown as { tasks: unknown[]; tasksTotal: number; tasksTruncated: boolean };
  const ms3 = performance.now() - t3;
  // eslint-disable-next-line no-console
  console.log(`[perf] modelContext з 10k завдань = ${ms3.toFixed(1)}ms, у контексті=${context.tasks.length}, розмір=${JSON.stringify(context).length}Б`);
  assert.equal(context.tasks.length, 200, 'список обрізаний до ліміту контексту');
  assert.equal(context.tasksTotal, 10_000);
  assert.equal(context.tasksTruncated, true, 'обрізання явне, не мовчки');
  assert.ok(ms3 < 3000, `побудова контексту ${ms3.toFixed(1)}ms`);
  assert.ok(JSON.stringify(context).length < 240_000, 'контекст в межах ліміту route');
});

test('06: префід нагадувань і підтримка браузера', () => {
  clearAll();
  assert.equal(inAppRemindersEnabled(), true, 'типово увімкнено');
  setInAppRemindersEnabled(false);
  assert.equal(inAppRemindersEnabled(), false);
  setInAppRemindersEnabled(true);
  assert.equal(browserNotificationsSupported(), typeof Notification !== 'undefined');
});
