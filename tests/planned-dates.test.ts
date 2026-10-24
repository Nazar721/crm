import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlannedDate, plannedDaysLeft, plannedDueCount } from '@/lib/planned-projects';
import { clearAll, bootStore } from './helpers';
import { savePlannedProject } from '@/lib/actions';
import * as store from '@/lib/store';
import { buildExportPayload } from '@/lib/export';
import { validateBackup } from '@/lib/validate-backup';
import { applyImport } from '@/lib/importer';
import type { PlannedProject } from '@/types';

const project = (plannedDate?: string): PlannedProject => ({ id: 'p', name: 'Проєкт', category: 'IT', clientName: 'Клієнт', plannedDate });

test('planned indicator includes only today, tomorrow and exactly two calendar days', () => {
  const dates = [undefined, '', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', 'invalid'];
  assert.equal(plannedDueCount(dates.map(project), '2026-10-25'), 3);
  assert.equal(plannedDueCount([project('2026-10-28')], '2026-10-26'), 1);
  assert.equal(plannedDueCount([project('2026-10-25')], '2026-10-26'), 0);
});

test('calendar dates reject normalized bad dates and handle Kyiv DST/year boundaries', () => {
  for (const value of ['2026-02-30', '2026-13-01', '2026-10-25T00:00:00Z', 123, null]) assert.equal(isPlannedDate(value), false);
  assert.equal(isPlannedDate('2028-02-29'), true);
  assert.equal(plannedDaysLeft(project('2026-10-26'), '2026-10-24'), 2);
  assert.equal(plannedDaysLeft(project('2027-01-01'), '2026-12-30'), 2);
  assert.equal(plannedDaysLeft(project()), null);
});

test('date persists, survives import and unrelated edits, can be changed and cleared', async () => {
  clearAll(); await bootStore();
  const fields = { name: 'Запланований', category: 'IT', clientName: 'Клієнт', plannedDate: '2026-10-27' };
  const saved = await savePlannedProject(fields);
  assert.equal(saved.ok, true);
  const id = store.getSnapshot().plannedProjects[0].id;
  assert.equal(store.getSnapshot().plannedProjects[0].plannedDate, fields.plannedDate);
  const payload = buildExportPayload(store.getSnapshot());
  assert.equal(validateBackup(payload).content!.plannedProjects[0].plannedDate, fields.plannedDate);
  assert.equal((await applyImport(payload)).ok, true);
  assert.equal(store.getSnapshot().plannedProjects[0].plannedDate, fields.plannedDate);
  await savePlannedProject({ ...fields, plannedDate: undefined, name: 'Нова назва' }, id);
  assert.equal(store.getSnapshot().plannedProjects[0].plannedDate, fields.plannedDate);
  await savePlannedProject({ ...fields, plannedDate: '2026-11-02' }, id);
  assert.equal(store.getSnapshot().plannedProjects[0].plannedDate, '2026-11-02');
  await savePlannedProject({ ...fields, plannedDate: '' }, id);
  assert.equal(store.getSnapshot().plannedProjects[0].plannedDate, undefined);
});

test('invalid dates are blocked before a write; old undated projects stay valid', async () => {
  clearAll(); await bootStore();
  const fields = { name: 'Запланований', category: 'IT', clientName: 'Клієнт' };
  assert.equal((await savePlannedProject({ ...fields, plannedDate: '2026-02-30' })).ok, false);
  assert.equal(store.getSnapshot().plannedProjects.length, 0);
  assert.equal((await savePlannedProject(fields)).ok, true);
  const payload = buildExportPayload(store.getSnapshot());
  assert.equal(validateBackup(payload).ok, true);
  payload.data.plannedProjects[0].plannedDate = 'bad';
  assert.ok(validateBackup(payload).recordIssues.some(issue => issue.message.includes('запланована дата')));
});
