import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReminderDeliveryGate, deliverDueReminders } from '@/lib/reminder-delivery';
import { saveTask, markRemindersShown } from '@/lib/actions';
import * as store from '@/lib/store';
import { clearAll, bootStore } from './helpers';
import type { Task } from '@/types';

// ============================================================
// Оркестрація показу нагадувань (огляд 04–06, P1): показ = позначка,
// прихована вкладка, in-flight guard, збій позначки без сліпого повтору.
// ============================================================

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, title: `Завдання ${id}`, priority: 'normal', status: 'planned',
    reminderAt: '2026-10-13T08:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2026-10-13T12:00:00Z');

test('доставка: всі due показуються і позначаються (без прихованого slice)', async () => {
  const tasks = ['a', 'b', 'c', 'd', 'e'].map(id => task(id));
  const shown: string[] = [];
  const result = await deliverDueReminders({
    tasks, now: NOW, enabled: true, visible: true,
    deliver: t => { shown.push(t.id); },
    claim: async ids => ({ ok: ids.length === 5 }),
  });
  assert.equal(shown.length, 5, 'показано ВСІ due, а не частину');
  assert.equal(result.shown.length, 5);
  assert.deepEqual(result.claimed.sort(), ['a', 'b', 'c', 'd', 'e'], 'позначено рівно показані');
});

test('доставка: показане = позначене; виконане/скасоване/показане не доставляється', async () => {
  const tasks: Task[] = [
    task('due1'),
    task('done1', { status: 'done' }),
    task('cancel1', { status: 'cancelled' }),
    task('shown1', { reminderShownAt: '2026-10-13T08:00:01.000Z' }),
    task('future1', { reminderAt: '2026-10-14T08:00:00.000Z' }),
  ];
  const shown: string[] = [];
  const result = await deliverDueReminders({
    tasks, now: NOW, enabled: true, visible: true,
    deliver: t => { shown.push(t.id); },
    claim: async ids => ({ ok: true }),
  });
  assert.deepEqual(shown, ['due1'], 'лише невиконане, непоказане, минуле');
  assert.deepEqual(result.claimed, ['due1']);
});

test('доставка: прихована вкладка та вимкнення не споживають нагадування', async () => {
  const tasks = [task('a')];
  let delivered = 0;
  const base = {
    tasks, now: NOW,
    deliver: () => { delivered += 1; },
    claim: async () => ({ ok: true }),
  };
  const hidden = await deliverDueReminders({ ...base, enabled: true, visible: false });
  assert.equal(hidden.skipped, 'hidden');
  const disabled = await deliverDueReminders({ ...base, enabled: false, visible: true });
  assert.equal(disabled.skipped, 'disabled');
  assert.equal(delivered, 0, 'жодного показу у прихованій/вимкненій вкладці');
});

test('доставка: in-flight guard — одночасні перевірки не споживають пачку двічі', async () => {
  const gate = createReminderDeliveryGate();
  const tasks = [task('a')];
  let delivered = 0;
  let release: (() => void) | null = null;
  const slow = new Promise<void>(resolve => { release = () => resolve(); });
  const first = gate.run(async () => {
    await slow;
    await deliverDueReminders({
      tasks, now: NOW, enabled: true, visible: true,
      deliver: () => { delivered += 1; },
      claim: async () => ({ ok: true }),
    });
  });
  const second = await gate.run(async () => 'never');
  assert.equal(second, 'in-flight', 'друга перевірка відкинута, поки перша в роботі');
  release!();
  await first;
  assert.equal(delivered, 1, 'пачку показано рівно один раз');
});

test('доставка: збій показу одного не блокує решту; позначається лише показане', async () => {
  const tasks = [task('ok1'), task('bad'), task('ok2')];
  const shown: string[] = [];
  const result = await deliverDueReminders({
    tasks, now: NOW, enabled: true, visible: true,
    deliver: t => {
      if (t.id === 'bad') throw new Error('render failed');
      shown.push(t.id);
    },
    claim: async ids => ({ ok: true }),
  });
  assert.deepEqual(shown, ['ok1', 'ok2']);
  assert.deepEqual(result.claimed.sort(), ['ok1', 'ok2'], 'невдалий показ не позначається');
});

test('доставка: збій позначки → без сліпого повтору, з callback синхронізації', async () => {
  const tasks = [task('a')];
  let claimCalls = 0;
  let synced = 0;
  const result = await deliverDueReminders({
    tasks, now: NOW, enabled: true, visible: true,
    deliver: () => undefined,
    claim: async () => { claimCalls += 1; return { ok: false }; },
    onClaimFailed: () => { synced += 1; },
  });
  assert.deepEqual(result.shown, ['a']);
  assert.deepEqual(result.claimed, [], 'показане не позначено без успіху');
  assert.equal(claimCalls, 1, 'без повторної спроби позначки в тій самій перевірці');
  assert.equal(synced, 1, 'викликано синхронізацію стану');
});

test('доставка: конкурентний стан (інший пристрій уже позначив) — фільтр реально актуальних', async () => {
  clearAll();
  await bootStore();
  await saveTask({ title: 'Одне', reminderDate: '2026-10-13', reminderTime: '08:00' });
  await saveTask({ title: 'Друге', reminderDate: '2026-10-13', reminderTime: '08:00' });
  const ids = store.getSnapshot().tasks.map(t => t.id);
  // «Інший пристрій» уже позначив перше завдання (стан у сховищі).
  const firstId = ids[0];
  await markRemindersShown([firstId]);
  // Повторна позначка того самого списку: друге вже показане позначкою вище,
  // перше — ні; фільтр бере лише реально невказані.
  const result = await markRemindersShown(ids);
  assert.equal(result.ok, true);
  const tasksNow = store.getSnapshot().tasks;
  assert.ok(tasksNow.every(t => t.reminderShownAt), 'обидва врешті позначені');
  // Виконане завдання не «оживає» старим нагадуванням.
  const done = tasksNow[0];
  await store.atomicAction(async () => {
    const list = store.getSnapshot().tasks.map(t => (t.id === done.id ? { ...t, status: 'done' as const } : t));
    const outcome = await store.saveCollection('tasks', list);
    return outcome.ok ? { ok: true } : { ok: false, errors: [{ message: outcome.issue.message }] };
  });
  const rerun = await markRemindersShown([done.id]);
  assert.equal(rerun.ok, true, 'повторна позначка виконаного — без помилки');
});
