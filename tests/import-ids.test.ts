import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, bootStore } from './helpers';
import { buildExportPayload } from '@/lib/export';
import { validateBackup } from '@/lib/validate-backup';
import { applyImport } from '@/lib/importer';
import { applyAssistantPlan, savePlannedProject } from '@/lib/actions';
import { fingerprint, normalizePlan } from '@/lib/assistant/plan';
import * as store from '@/lib/store';
import type { ExportPayload, HostingPayment, HostingService, Task } from '@/types';

// ============================================================
// Рев'ю 18.10 (блокер): імпорт не має стирати ID записів.
// Спільна перевірка baseRecordChecks для hostingServices,
// hostingPayments, tasks, plannedProjects; початкові ID
// зберігаються; биті ID → recordIssue, без маскування.
// ============================================================

const NEW_COLLECTIONS = ['hostingServices', 'hostingPayments', 'tasks', 'plannedProjects'] as const;

function seedPayload(): ExportPayload {
  const payload = buildExportPayload(store.getSnapshot());
  const data = payload.data as unknown as Record<string, unknown[]>;
  data.hostingServices = [
    { id: 'hs-alpha', name: 'Hosp Alpha', currency: 'UAH' },
    { id: 'hs-beta', name: 'Hosp Beta', currency: 'USD', site: 'beta.example' },
  ] satisfies HostingService[];
  data.hostingPayments = [
    { id: 'hp-1', serviceId: 'hs-alpha', date: '2026-10-01', amount: 100, currency: 'UAH', periodStart: '2026-10-01', periodEnd: '2026-11-01' },
    { id: 'hp-2', serviceId: 'hs-beta', date: '2026-11-01', amount: 200, currency: 'USD', periodStart: '2026-11-01', periodEnd: '2026-12-01' },
  ] satisfies HostingPayment[];
  data.tasks = [
    { id: 'task-1', title: 'Завдання 1', priority: 'high', status: 'planned', dueDate: '2026-10-20' },
    { id: 'task-2', title: 'Завдання 2', priority: 'low', status: 'done', completedAt: '2026-10-10T10:00:00.000Z' },
  ] satisfies Task[];
  return payload;
}

test('імпорт зберігає початкові ID всіх чотирьох колекцій; зв’язки й довгий опис без втрат', async () => {
  clearAll();
  await bootStore();
  const longDescription = 'Опис '.repeat(500);
  const a = await savePlannedProject({ name: 'Проєкт А', category: 'IT', clientName: 'Alice', description: longDescription });
  const b = await savePlannedProject({ name: 'Проєкт Б', category: 'Design', clientName: 'Bob' });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const plannedIds = store.getSnapshot().plannedProjects.map(p => p.id);
  assert.ok(plannedIds.every(Boolean), 'дії згенерували непорожні ID');
  const storedDescription = store.getSnapshot().plannedProjects[0].description!;
  assert.ok(storedDescription.length > 2000, 'довгий опис збережено понад 2000 символів');
  const payload = seedPayload();

  const v = validateBackup(payload);
  assert.equal(v.ok, true);
  assert.deepEqual(
    v.warnings.filter(w => w.collection && (NEW_COLLECTIONS as readonly string[]).includes(w.collection)),
    [],
    'власний експорт — без попереджень нових колекцій',
  );
  assert.equal(v.counts.hostingServices, 2);
  assert.equal(v.counts.hostingPayments, 2);
  assert.equal(v.counts.tasks, 2);
  assert.equal(v.counts.plannedProjects, 2);
  assert.ok(v.content!.hostingPayments.every(p => p.id && p.serviceId), 'ID і serviceId у валідованому вмісті');

  clearAll();
  await bootStore();
  const report = await applyImport(payload);
  assert.equal(report.ok, true);
  const s = store.getSnapshot();
  assert.deepEqual(s.hostingServices.map(h => h.id), ['hs-alpha', 'hs-beta'], 'ID послуг збережено');
  assert.deepEqual(s.hostingPayments.map(p => p.id), ['hp-1', 'hp-2'], 'ID оплат збережено');
  assert.deepEqual(s.hostingPayments.map(p => p.serviceId), ['hs-alpha', 'hs-beta'], 'serviceId без змін');
  assert.deepEqual(s.tasks.map(t => t.id), ['task-1', 'task-2'], 'ID завдань збережено');
  assert.deepEqual(s.plannedProjects.map(p => p.id), plannedIds, 'ID запланованих збережено');
  assert.equal(s.tasks.find(t => t.id === 'task-2')!.status, 'done');
  const restoredLong = s.plannedProjects.find(p => p.id === plannedIds[0])!;
  assert.equal(restoredLong.description, storedDescription, 'довгий опис без втрат');
  assert.equal(restoredLong.name, 'Проєкт А');

  // Редагування planned за початковим ID після імпорту: UI-дія
  const uiEdit = await savePlannedProject(
    { name: 'Проєкт А (ред.)', category: 'IT', clientName: 'Alice', description: storedDescription },
    plannedIds[0],
  );
  assert.equal(uiEdit.ok, true, 'UI-дія знаходить запис за початковим ID');
  assert.equal(store.getSnapshot().plannedProjects.find(p => p.id === plannedIds[0])!.name, 'Проєкт А (ред.)');

  // Редагування planned за початковим ID після імпорту: AI-ланцюжок
  const aiPlan = normalizePlan(
    { domain: 'plannedProjects', action: 'update', recordId: plannedIds[1], fields: { description: 'AI опис' } },
    store.getSnapshot(),
  );
  const aiApplied = await applyAssistantPlan({ ...aiPlan, base: await fingerprint(store.getSnapshot()) } as never);
  assert.equal(aiApplied.ok, true, 'AI-оновлення знаходить запис за початковим ID');
  assert.equal(store.getSnapshot().plannedProjects.find(p => p.id === plannedIds[1])!.description, 'AI опис');
});

test('биті ID (відсутній/порожній/null/числовий) → recordIssue і пропуск, без id:\"\"', () => {
  clearAll();
  const payload = seedPayload();
  const data = payload.data as unknown as Record<string, unknown[]>;
  const badPayment = { serviceId: 'hs-alpha', date: '2026-10-01', amount: 1, currency: 'UAH', periodStart: '2026-10-01', periodEnd: '2026-10-02' };
  data.plannedProjects = [
    { name: 'Без ID', category: 'IT', clientName: 'X' },
    { id: '', name: 'Порожній ID', category: 'IT', clientName: 'X' },
    { id: null, name: 'Null ID', category: 'IT', clientName: 'X' },
    { id: 42, name: 'Числовий ID', category: 'IT', clientName: 'X' },
  ];
  data.tasks = [
    { title: 'Без ID' },
    { id: '', title: 'Порожній ID' },
    { id: null, title: 'Null ID' },
    { id: 42, title: 'Числовий ID' },
  ];
  data.hostingServices = [
    { name: 'Без ID', currency: 'UAH' },
    { id: '', name: 'Порожній ID', currency: 'UAH' },
    { id: null, name: 'Null ID', currency: 'UAH' },
    { id: 42, name: 'Числовий ID', currency: 'UAH' },
  ];
  data.hostingPayments = [
    { ...badPayment },
    { ...badPayment, id: '' },
    { ...badPayment, id: null },
    { ...badPayment, id: 42 },
  ];

  const v = validateBackup(payload);
  assert.equal(v.ok, true, 'пропуски записів — recordIssues, не блокуючі errors');
  for (const key of NEW_COLLECTIONS) {
    assert.equal(v.counts[key], 0, `${key}: жодного запису не прийнято з битим ID`);
    assert.equal(v.skipped[key], 4, `${key}: чотири биті ID пропущено`);
  }
  for (const key of NEW_COLLECTIONS) {
    const issues = v.recordIssues.filter(i => i.collection === key);
    assert.equal(issues.length, 4, `${key}: по одній помилці на запис`);
    assert.ok(issues.every(i => (i.message || '').includes('відсутній або некоректний id')), `${key}: чесна помилка ID`);
    assert.ok(issues.every(i => i.id === undefined || i.id === ''), `${key}: без підробленого ID в issues`);
  }
  assert.deepEqual(v.content!.plannedProjects, [], 'немасковані ID не потрапили у вміст');
});

test('дублікат ID у новій колекції → відхилення всього імпорту', () => {
  clearAll();
  const payload = seedPayload();
  const data = payload.data as unknown as Record<string, unknown[]>;
  data.plannedProjects = [
    { id: 'pp-x', name: 'A', category: 'IT', clientName: 'A' },
    { id: 'pp-x', name: 'B', category: 'IT', clientName: 'B' },
  ];
  const v = validateBackup(payload);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => (e.message || '').includes('дублікат id «pp-x»')), 'дублікат id — блокуюча помилка');
});

test('хостинг: послуга з оплатою проходить імпорт з незмінним serviceId', async () => {
  clearAll();
  await bootStore();
  const payload = seedPayload();
  const report = await applyImport(payload);
  assert.equal(report.ok, true);
  const s = store.getSnapshot();
  const service = s.hostingServices.find(h => h.id === 'hs-alpha');
  assert.ok(service, 'послуга за початковим ID');
  const linked = s.hostingPayments.filter(p => p.serviceId === service!.id);
  assert.equal(linked.length, 1, 'оплата лише своєї послуги');
  assert.equal(linked[0].id, 'hp-1');
  assert.equal(linked[0].amount, 100);
});
