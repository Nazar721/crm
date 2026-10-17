import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  browserNotificationsSupported, buildTaskSavePayload, dueReminders, filterTasks, inAppRemindersEnabled,
  isReminderDue, isIsoInstant, isValidTaskDate, isValidTaskTime,
  reminderIdsToMark, setInAppRemindersEnabled, snoozeReminderIso,
  taskCounts, taskDateTimeFields, taskSchedule, validateTaskInput,
} from '@/lib/tasks';
import { kyivDateTimeToIso } from '@/lib/dates';
import {
  applyAssistantPlan, cancelTask, completeTask, markRemindersShown, savePlannedProject, saveTask, saveRates, snoozeTaskReminder,
} from '@/lib/actions';
import { fingerprint, missingQuestions, modelContext, normalizePlan } from '@/lib/assistant/plan';
import { dashboardStats } from '@/lib/calc';
import { buildExportPayload } from '@/lib/export';
import { applyImport } from '@/lib/importer';
import { validateBackup } from '@/lib/validate-backup';
import * as store from '@/lib/store';
import { clearAll, bootStore, emptySnapshot, makeClient } from './helpers';
import type { PlannedProject, Task } from '@/types';

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
  // Строгість: «30 лютого» та 25:99 відкидаються (огляд 04–06)
  assert.equal(isValidTaskDate('2026-02-30'), false, '30 лютого не існує');
  assert.equal(isValidTaskDate('2024-02-29'), true, 'високосний 29 лютого — ок');
  assert.equal(isValidTaskTime('25:99'), false);
  assert.equal(isValidTaskTime('23:59'), true);
  // Однозначний ISO-інстант: з таймзоною — так; без — ні (огляд 04–06)
  assert.equal(isIsoInstant('2026-10-14T07:00:00Z'), true);
  assert.equal(isIsoInstant('2026-10-14T07:00:00+03:00'), true);
  assert.equal(isIsoInstant('2026-10-14T07:00:00'), false, 'без таймзонои — неоднозначний');
  assert.equal(isIsoInstant('2026-02-30T07:00:00Z'), false, '30 лютого — неможлива календарна дата');
  assert.equal(isIsoInstant('2024-02-29T10:00:00Z'), true, 'високосний 29 лютого — ок');
  assert.equal(isIsoInstant('2026-10-14T07:00:00+99:00'), false, 'неможливий зсув');
  for (const offset of ['+15:00', '-15:00', '+14:01', '-14:01', '+1401']) {
    for (const seconds of [':00', ':00.123', '']) {
      assert.equal(isIsoInstant(`2026-10-14T07:00${seconds}${offset}`), false, 'зсув поза межею ±14:00');
    }
  }
  for (const offset of ['+14:00', '-14:00', '+1400', '-1400']) {
    assert.equal(isIsoInstant(`2026-10-14T07:00:00.123${offset}`), true, 'граничний зсув дозволений');
  }
  assert.equal(
    validateTaskInput({ title: 'OK', reminderAt: '2026-10-14T07:00:00' }).some(e => e.field === 'reminderAt'),
    true,
    'прямий reminderAt без таймзонои відхиляється',
  );
});

test('форма: неповне нагадування не ховається від валідатора (payload/handleSave)', () => {
  const base = {
    title: 'З форми', description: '', priority: 'normal', status: 'planned',
    dueDate: '', dueTime: '', reminderDate: '2026-10-14', reminderTime: '', reminderClear: false,
  };
  // Неповна пара → НЕ ok: діалог лишається відкритим, onSave не викликається.
  const incomplete = buildTaskSavePayload(base);
  assert.equal(incomplete.ok, false);
  assert.ok(!incomplete.ok && incomplete.error.includes('нагадування'), 'видима помилка про пара нагадування');
  // Обидва порожні → ok; чинне нагадування зберігається (payload без нагадування).
  const emptyPair = buildTaskSavePayload({ ...base, reminderDate: '', reminderTime: '' });
  assert.ok(emptyPair.ok);
  assert.equal(emptyPair.ok && emptyPair.payload.reminderDate, '');
  // Повна пара → payload відкрито містить обидві поля (не ховає від actions).
  const full = buildTaskSavePayload({ ...base, reminderTime: '10:00' });
  assert.ok(full.ok);
  assert.equal(full.ok && full.payload.reminderDate, '2026-10-14');
  assert.equal(full.ok && full.payload.reminderTime, '10:00');
  // Явний reminderClear працює.
  const cleared = buildTaskSavePayload({ ...base, reminderDate: '', reminderTime: '', reminderClear: true });
  assert.ok(cleared.ok);
  assert.equal(cleared.ok && cleared.payload.reminderClear, true);
  // Неможливий стінний час (весняна прогалина Kyiv) — теж видима відмова форми.
  const dst = buildTaskSavePayload({ ...base, reminderDate: '2027-03-28', reminderTime: '03:30' });
  assert.equal(dst.ok, false);
  assert.ok(!dst.ok && dst.error.includes('Kyiv'));
});

test('дії: неможливий стінний час Kyiv відхиляється без запису (створення й оновлення)', async () => {
  clearAll();
  await bootStore();
  // 28.03.2027 — остання неділя березня; 03:00–03:59 Kyiv не існують (перехід).
  assert.equal(kyivDateTimeToIso('2027-03-28', '03:30'), null, 'такого стінного часу в Kyiv немає');
  assert.equal(kyivDateTimeToIso('2027-03-28', '04:30') !== null, true, 'час після переходу — ок');
  assert.equal(validateTaskInput({ title: 'DST', reminderDate: '2027-03-28', reminderTime: '03:30' }).length > 0, true);
  assert.equal(validateTaskInput({ title: 'DST', dueDate: '2027-03-28', dueTime: '03:30' }).length > 0, true);
  // Створення: явна відмова, жодного запису.
  const created = await saveTask({ title: 'DST', reminderDate: '2027-03-28', reminderTime: '03:30' });
  assert.equal(created.ok, false);
  assert.equal(store.getSnapshot().tasks.length, 0, 'жодного часткового запису');
  // Оновлення: ефективна пара (наявний дедлайн + новий час) — відмова, стан без змін.
  await saveTask({ title: 'Звичайне', dueDate: '2027-03-28', dueTime: '10:00' });
  const before = structuredClone(store.getSnapshot().tasks[0]);
  const updated = await saveTask({ dueTime: '03:30' }, before.id);
  assert.equal(updated.ok, false);
  assert.deepEqual(store.getSnapshot().tasks[0], before, 'стан без змін після відмови');
  // Позитиви: високосний день і звичайний момент приймаються.
  assert.equal(kyivDateTimeToIso('2024-02-29', '10:00') !== null, true);
  const ok = await saveTask({ title: 'Високосний', reminderDate: '2024-02-29', reminderTime: '10:00' });
  assert.equal(ok.ok, true);
  const leap = store.getSnapshot().tasks.find(t => t.title === 'Високосний')!;
  assert.ok(leap.reminderAt, 'високосний момент прийнято');
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
  // Неповне нагадування (дата без часу) → явна помилка, не мовчкивий запуск
  const incomplete = await saveTask({ title: 'Без часу', reminderDate: '2026-10-19' });
  assert.equal(incomplete.ok, false, 'неповна пара дата/час — відмова');
  assert.equal(store.getSnapshot().tasks.length, 1, 'жодного часткового запису');
  // Часткове редагування (лише дата) НЕ прибирає чинне нагадування мовчки
  const partial = await saveTask({ reminderDate: '2026-01-20' }, t.id);
  assert.equal(partial.ok, false, 'часткова зміна нагадування — відмова, чинне збережено');
  assert.equal(store.getSnapshot().tasks[0].reminderAt, t.reminderAt, 'чинне нагадування недоторкане');
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
// AI: домен plannedProjects (пакет 06; tasks-домен прибрано)
// ------------------------------------------------------------

test('AI: обов’язкова назва/клієнт, дефолти, контекст plannedProjects', async () => {
  const planned = (overrides: Partial<PlannedProject> = {}): PlannedProject => ({
    id: 'pp1', name: 'Сайт для крамниці', category: 'IT', clientName: 'Марія', ...overrides,
  });
  const s = { ...emptySnapshot(), plannedProjects: [planned()] };
  const planNoName = normalizePlan({ domain: 'plannedProjects', action: 'create', fields: { category: 'Design' } }, s);
  assert.deepEqual(
    missingQuestions(planNoName, s).map(q => q.key),
    ['name', 'clientName'],
    'без назви й клієнта — уточнення',
  );
  const plan = normalizePlan(
    { domain: 'plannedProjects', action: 'create', fields: { name: 'Лендінг', category: 'Design', clientName: 'Олег' } },
    s,
  );
  assert.equal(plan.fields.category, 'Design');
  const context = modelContext(s) as unknown as { plannedProjects: { list: { id: string }[]; total: number; truncated: boolean } };
  assert.equal(context.plannedProjects.list.length, 1);
  assert.equal(context.plannedProjects.total, 1);
  assert.equal(context.plannedProjects.truncated, false);
  await clearAll();
  await bootStore();
  // Ланцюжок: уточнення → чернетка → підтвердження → одна зміна → журнал
  const first = normalizePlan({ domain: 'plannedProjects', action: 'create', fields: {} }, store.getSnapshot());
  assert.ok(missingQuestions(first, store.getSnapshot()).length > 0, 'без назви — уточнення');
  const draft = normalizePlan(
    { domain: 'plannedProjects', action: 'create', fields: { name: 'З чату', category: 'IT', clientName: 'Олег' } },
    store.getSnapshot(),
  );
  const applied = await applyAssistantPlan({ ...draft, base: await fingerprint(store.getSnapshot()) } as never);
  assert.equal(applied.ok, true);
  assert.equal(store.getSnapshot().plannedProjects.length, 1);
  assert.equal(store.getSnapshot().plannedProjects[0].name, 'З чату');
  const events = await store.listHistory({ limit: 20 });
  assert.equal(events.events.filter(e => e.changes.some(c => c.collection === 'plannedProjects')).length, 1, 'одна фактична зміна → одна група');
  // Повторне підтвердження тієї ж чернетки → без дубліката
  const repeat = await applyAssistantPlan({ ...draft, base: 'stale' } as never);
  assert.equal(repeat.ok, false);
  assert.equal(store.getSnapshot().plannedProjects.length, 1);
});

// ------------------------------------------------------------
// 06-рев'ю 18.10: plannedProjects — backup round-trip без втрат,
// partial update, канонічний клієнт (форма ↔ AI ↔ запис)
// ------------------------------------------------------------

test('06-рев’ю: backup round-trip — довгий опис і поля без мовчазного обрізання', async () => {
  clearAll();
  await bootStore();
  const description = 'Опис '.repeat(500);
  const saved = await savePlannedProject({
    name: 'Лендінг з довгим описом',
    category: 'Design',
    clientName: 'Марія',
    description,
  });
  assert.equal(saved.ok, true);
  const stored = store.getSnapshot().plannedProjects[0];
  assert.ok(stored.description!.length > 2000, 'запис понад 2000 символів дозволений');
  const payload = buildExportPayload(store.getSnapshot());
  const v = validateBackup(payload);
  assert.equal(v.ok, true);
  assert.equal(v.counts.plannedProjects, 1);
  assert.deepEqual(v.warnings.filter(w => w.collection === 'plannedProjects'), [], 'власний експорт — без попереджень');
  assert.deepEqual(v.recordIssues.filter(i => i.collection === 'plannedProjects'), [], 'власний експорт — без issues');
  clearAll();
  await bootStore();
  const report = await applyImport(payload);
  assert.equal(report.ok, true);
  const restored = store.getSnapshot().plannedProjects[0];
  assert.equal(restored.description, stored.description, 'опис відновлюється повністю');
  assert.equal(restored.name, stored.name);
  assert.equal(restored.clientName, stored.clientName);
  assert.equal(restored.category, stored.category);
});

test('06-рев’ю: AI partial update — окремо опис/назва/категорія, без втрати полів', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [makeClient({ id: 'client-a', name: 'Alice' })]);
  const saved = await savePlannedProject({
    name: 'Сайт', category: 'IT', clientName: 'Alice', clientId: 'client-a', description: 'Старий опис',
  });
  assert.equal(saved.ok, true);
  const id = store.getSnapshot().plannedProjects[0].id;

  const updDesc = normalizePlan(
    { domain: 'plannedProjects', action: 'update', recordId: id, fields: { description: 'Новий опис' } },
    store.getSnapshot(),
  );
  assert.deepEqual(missingQuestions(updDesc, store.getSnapshot()), [], 'оновлення опису не потребує уточнень');
  const applied1 = await applyAssistantPlan({ ...updDesc, base: await fingerprint(store.getSnapshot()) } as never);
  assert.equal(applied1.ok, true);
  let rec = store.getSnapshot().plannedProjects[0];
  assert.equal(rec.description, 'Новий опис');
  assert.equal(rec.name, 'Сайт');
  assert.equal(rec.category, 'IT');
  assert.equal(rec.clientId, 'client-a', 'зв’язок із клієнтом збережено');
  assert.equal(rec.clientName, 'Alice');

  const updName = normalizePlan(
    { domain: 'plannedProjects', action: 'update', recordId: id, fields: { name: 'Лендінг' } },
    store.getSnapshot(),
  );
  const applied2 = await applyAssistantPlan({ ...updName, base: await fingerprint(store.getSnapshot()) } as never);
  assert.equal(applied2.ok, true);
  rec = store.getSnapshot().plannedProjects[0];
  assert.equal(rec.name, 'Лендінг');
  assert.equal(rec.description, 'Новий опис', 'опис не загублено при зміні назви');

  const updCat = normalizePlan(
    { domain: 'plannedProjects', action: 'update', recordId: id, fields: { category: 'Video' } },
    store.getSnapshot(),
  );
  const applied3 = await applyAssistantPlan({ ...updCat, base: await fingerprint(store.getSnapshot()) } as never);
  assert.equal(applied3.ok, true);
  rec = store.getSnapshot().plannedProjects[0];
  assert.equal(rec.category, 'Video');
  assert.equal(rec.name, 'Лендінг');
  assert.equal(rec.clientId, 'client-a');

  // Явне очищення опису: порожній рядок → undefined
  const clearDesc = normalizePlan(
    { domain: 'plannedProjects', action: 'update', recordId: id, fields: { description: '' } },
    store.getSnapshot(),
  );
  const appliedClear = await applyAssistantPlan({ ...clearDesc, base: await fingerprint(store.getSnapshot()) } as never);
  assert.equal(appliedClear.ok, true);
  assert.equal(store.getSnapshot().plannedProjects[0].description, undefined, 'порожній опис — явне очищення');

  // Stale base → відмова без змін і без дубля
  const beforeStale = store.getSnapshot().plannedProjects[0];
  const plannedBefore = store.getSnapshot().plannedProjects.length;
  const stale = await applyAssistantPlan({ ...updName, base: 'stale' } as never);
  assert.equal(stale.ok, false);
  assert.equal(store.getSnapshot().plannedProjects.length, plannedBefore);
  assert.deepEqual(store.getSnapshot().plannedProjects[0], beforeStale);

  const events = await store.listHistory({ limit: 50 });
  const plannedEvents = events.events.filter(e => e.changes.some(c => c.collection === 'plannedProjects'));
  assert.equal(plannedEvents.length, 5, 'створення + 4 успішні оновлення = одна група на підтвердження');
});

test('06-рев’ю: клієнт — канонічне ім’я картки, відмова на невідомий ID, ручний перехід', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [
    makeClient({ id: 'client-a', name: 'Alice' }),
    makeClient({ id: 'client-b', name: 'Bob' }),
  ]);
  // Mismatch: ім’я Bob + ID Alice → канонічне ім’я обраної картки
  const mismatch = await savePlannedProject({ name: 'Wrong card', category: 'IT', clientName: 'Bob', clientId: 'client-a' });
  assert.equal(mismatch.ok, true);
  const wrong = store.getSnapshot().plannedProjects[0];
  assert.equal(wrong.clientName, 'Alice', 'картка — джерело канонічного імені');
  assert.equal(wrong.clientId, 'client-a');

  // Невідомий ID → зрозуміла відмова; snapshot та історія без змін
  const historyBefore = (await store.listHistory({ limit: 50 })).events.length;
  const snapshotBefore = store.getSnapshot();
  const unknown = await savePlannedProject({ name: 'Stale', category: 'IT', clientName: 'Alice', clientId: 'nonexistent' });
  assert.equal(unknown.ok, false);
  assert.deepEqual(store.getSnapshot(), snapshotBefore, 'невдала валідація не змінює snapshot');
  assert.equal((await store.listHistory({ limit: 50 })).events.length, historyBefore, 'історія без нових подій');

  // Неправильний тип ID → відмова
  const wrongType = await savePlannedProject({ name: 'Тип', category: 'IT', clientName: 'X', clientId: 123 as never });
  assert.equal(wrongType.ok, false);

  // Два клієнти з різними ID та однаковими іменами → вибір за ID, не за збігом імені
  await store.saveCollection('clients', [
    makeClient({ id: 'client-a', name: 'Alice' }),
    makeClient({ id: 'client-b', name: 'Alice' }),
  ]);
  const byId = await savePlannedProject({ name: 'За ID', category: 'IT', clientName: 'Alice', clientId: 'client-b' });
  assert.equal(byId.ok, true);
  const recById = store.getSnapshot().plannedProjects.find(p => p.name === 'За ID')!;
  assert.equal(recById.clientId, 'client-b');

  // AI-чернетка: відомий ID → канонічне ім’я; невідомий → відмова нормалізації
  const s = store.getSnapshot();
  const draftKnown = normalizePlan(
    { domain: 'plannedProjects', action: 'create', fields: { name: 'AI', category: 'IT', clientId: 'client-a', clientName: 'Bob' } },
    s,
  );
  assert.equal(draftKnown.fields.clientName, 'Alice', 'чернетка показує канонічне ім’я картки');
  assert.throws(
    () => normalizePlan({ domain: 'plannedProjects', action: 'create', fields: { name: 'AI', category: 'IT', clientId: 'ghost' } }, s),
    /не знайдено/,
  );

  // Partial edit опису через AI зберігає чинний зв’язок (фікс P2)
  const linked = store.getSnapshot().plannedProjects.find(p => p.name === 'За ID')!;
  const descUpd = normalizePlan(
    { domain: 'plannedProjects', action: 'update', recordId: linked.id, fields: { description: 'Лише опис' } },
    store.getSnapshot(),
  );
  const applied = await applyAssistantPlan({ ...descUpd, base: await fingerprint(store.getSnapshot()) } as never);
  assert.equal(applied.ok, true);
  const afterDesc = store.getSnapshot().plannedProjects.find(p => p.id === linked.id)!;
  assert.equal(afterDesc.description, 'Лише опис');
  assert.equal(afterDesc.clientId, 'client-b', 'зв’язок не втрачено при partial edit');
  assert.equal(afterDesc.clientName, 'Alice');

  // Явний перехід на ручне ім’я: update лише clientName → clientId: null у чернетці
  const manualDraft = normalizePlan(
    { domain: 'plannedProjects', action: 'update', recordId: linked.id, fields: { clientName: 'Ручний клієнт' } },
    store.getSnapshot(),
  );
  assert.equal(manualDraft.fields.clientId, null, 'перехід на ручне ім’я видимий у чернетці');
  const manualApplied = await applyAssistantPlan({ ...manualDraft, base: await fingerprint(store.getSnapshot()) } as never);
  assert.equal(manualApplied.ok, true);
  const manualRec = store.getSnapshot().plannedProjects.find(p => p.id === linked.id)!;
  assert.equal(manualRec.clientId, undefined, 'картку відв’язано');
  assert.equal(manualRec.clientName, 'Ручний клієнт');
  assert.equal(store.getSnapshot().clients.length, 2, 'ручне ім’я не створило картку');
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
  // Контекст AI-помічника: plannedProjects обрізається до ліміту явно.
  const big = emptySnapshot();
  big.plannedProjects = Array.from({ length: 10_000 }, (_, i) => ({
    id: `pp${i}`, name: `Проєкт ${i}`, category: i % 2 ? 'IT' : 'Design', clientName: `Клієнт ${i}`,
  }));
  const t3 = performance.now();
  const context = modelContext(big) as unknown as { plannedProjects: { list: unknown[]; total: number; truncated: boolean } };
  const ms3 = performance.now() - t3;
  // eslint-disable-next-line no-console
  console.log(`[perf] modelContext з 10k запланованих = ${ms3.toFixed(1)}ms, у контексті=${context.plannedProjects.list.length}, розмір=${JSON.stringify(context).length}Б`);
  assert.equal(context.plannedProjects.list.length, 200, 'список обрізаний до ліміту контексту');
  assert.equal(context.plannedProjects.total, 10_000);
  assert.equal(context.plannedProjects.truncated, true, 'обрізання явне, не мовчки');
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
