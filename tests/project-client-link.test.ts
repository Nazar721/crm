import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectPayload, type ProjectFormValues } from '@/lib/project-payload';
import { normalizePlan, missingQuestions, fingerprint, type Plan } from '@/lib/assistant/plan';
import { initialProjectForCopy, copyMissingWarnings } from '@/lib/copy-project';
import { saveProject } from '@/lib/actions';
import { executePlan } from '@/lib/assistant/executor';
import { SupabaseDataSource } from '@/lib/datasource/supabase';
import * as store from '@/lib/store';
import { today } from '@/lib/utils';
import { clearAll, emptySnapshot, makeProject, makeClient, snapshotFingerprint } from './helpers';
import type { Project } from '@/types';

// ---- Фейкова remote-база (той самий контракт, що й в інших тестах) ----
function database() {
  let snap = emptySnapshot(), revision = 0, commits = 0;
  return {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (name === 'crm_read') return { data: { snapshot: structuredClone(snap), revision }, error: null };
      commits++;
      if (args?.p_revision !== revision) return { data: null, error: { message: 'CRM_CONFLICT' } };
      snap = structuredClone(args?.p_snapshot as typeof snap);
      return { data: ++revision, error: null };
    },
    get snap() { return snap; },
    get commits() { return commits; },
  };
}

async function bootDb() {
  clearAll();
  const db = database();
  await store.initStore(new SupabaseDataSource(db.rpc));
  return db;
}

const cardA = makeClient({ id: 'cli_a', name: 'Анна (оновлено)', telegram: '@anna', source: 'Instagram' });
const cardB = makeClient({ id: 'cli_b', name: 'Борис', telegram: '@boris', source: 'Telegram' });

/** Завершений проєкт з історичними контактами клієнта (перейменованого карткою). */
function completedSource(overrides: Partial<Project> = {}): Project {
  return {
    ...makeProject({
      id: 'prj_src',
      name: 'Готовий сайт',
      status: 'Завершено',
      budget: 120000,
      prepayment: 60000,
      paidToSpecialist: 30000,
      profitTaken: 5000,
      bank: 'mono',
      endDate: '2026-02-01',
      finishDate: '2026-02-01',
      clientId: 'cli_a',
      clientName: 'Анна',          // історичне ім'я до перейменування картки
      clientTelegram: '@old_ann',  // історичний контакт
      clientSource: 'Telegram',
      developerId: '',
    }),
    ...overrides,
  } as Project;
}

const formValues = (): ProjectFormValues => ({
  name: 'Новий сайт', type: 'IT', status: 'Очікування оплати', startDate: today(),
  deadlineDays: '5', endDate: '', developerId: '', partnerId: '',
  clientName: 'Анна', clientTelegram: '@old_ann', clientSource: 'Telegram',
  budget: '100000', currency: 'UAH', bank: '', prepayment: '0', paidToSpecialist: '0',
  myPercent: '30', profitTaken: '0', fop: '10', partnerCommission: '0',
  description: '', selectedClientId: '',
});

// ============================================================
// 1–3. Форма: значення, які відправляє handleSave (buildProjectPayload)
// ============================================================

test('форма: копія з чинним перейменованим клієнтом відправляє точний ID і дані картки', () => {
  const payload = buildProjectPayload(
    { ...formValues(), selectedClientId: 'cli_a' },
    [cardA, cardB],
  );
  assert.equal(payload.clientId, 'cli_a', 'джерело clientId — поточний вибір, не prefill');
  assert.equal(payload.clientName, 'Анна (оновлено)', 'назва береться з картки, не історична');
  assert.equal(payload.clientTelegram, '@anna');
  assert.equal(payload.clientSource, 'Instagram');
});

test('форма: порожні telegram/source картки не повертаються з історичних контактів стану', () => {
  const emptyCard = makeClient({ id: 'cli_e', name: 'Ема', telegram: '', source: '' });
  const payload = buildProjectPayload(
    { ...formValues(), clientTelegram: '@old_ann', clientSource: 'Telegram', selectedClientId: 'cli_e' },
    [emptyCard],
  );
  assert.equal(payload.clientId, 'cli_e');
  assert.equal(payload.clientTelegram, '', 'порожнє актуальне значення — теж значення, без || до стану форми');
  assert.equal(payload.clientSource, 'Інше');
});

test('форма: вибір картки B у копії A відправляє саме B', () => {
  const payload = buildProjectPayload(
    { ...formValues(), selectedClientId: 'cli_b' },
    [cardA, cardB],
  );
  assert.equal(payload.clientId, 'cli_b');
  assert.equal(payload.clientName, 'Борис');
  assert.equal(payload.clientTelegram, '@boris');
});

test('форма: ручна зміна імені від’єднує ID — у payload не лишається старий зв’язок', () => {
  const payload = buildProjectPayload(
    { ...formValues(), selectedClientId: '', clientName: 'Новий клієнт' },
    [cardA, cardB],
  );
  assert.equal(payload.clientId, '', 'вибір скинуто ручною зміною імені');
  assert.equal(payload.clientName, 'Новий клієнт');
});

test('форма → saveProject: вибір картки B у копії A зберігає саме B (P1 з огляду)', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA, cardB]);
  await store.saveCollection('projectsCompleted', [completedSource()]);

  // Сценарій огляду: копія проєкту клієнта A → вибір B у формі → збереження.
  const payload = buildProjectPayload(
    { ...formValues(), selectedClientId: 'cli_b' },
    [cardA, cardB],
  );
  assert.equal(payload.clientId, 'cli_b', 'prefill не може перебити поточний вибір');
  const result = await saveProject(payload);
  if (!result.ok) assert.fail(result.errors.map(e => e.message).join('; '));
  const saved = db.snap.projectsActive[0];
  assert.equal(saved.clientId, 'cli_b', 'зв’язано з B, а не з A');
  assert.equal(saved.clientName, 'Борис');
  assert.equal(db.snap.clients.length, 2, 'жодної нової картки');
  assert.equal(db.snap.projectsCompleted[0].clientId, 'cli_a', 'джерело лише для читання');
});

test('форма → saveProject: ручна зміна імені не лишає ID картки A приховано (P1 з огляду)', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  await store.saveCollection('projectsCompleted', [completedSource()]);

  const payload = buildProjectPayload(
    { ...formValues(), selectedClientId: '', clientName: 'Інший клієнт' },
    [cardA],
  );
  assert.equal(payload.clientId, '', 'старий ID не ховається після ручної зміни');
  const result = await saveProject(payload);
  if (!result.ok) assert.fail(result.errors.map(e => e.message).join('; '));
  const saved = db.snap.projectsActive[0];
  assert.notEqual(saved.clientId, 'cli_a', 'зв’язок з A не збережено мовчки');
  assert.equal(saved.clientId, db.snap.clients.find(c => c.name === 'Інший клієнт')!.id);
  assert.equal(db.snap.clients.length, 2, 'створено картку для нового імені');
});

test('форма: видалений ID не ховається fallback на ім’я — збереження його відхиляє', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  const payload = buildProjectPayload(
    { ...formValues(), selectedClientId: 'cli_gone' },
    [cardA],
  );
  // ID збережено як є: відсутність картки не маскується підставою імені.
  assert.equal(payload.clientId, 'cli_gone');
  const before = snapshotFingerprint(db.snap);
  const result = await saveProject(payload);
  assert.equal(result.ok, false, 'неіснуючий ID має відхилити спільна дія');
  if (!result.ok) assert.ok(result.errors.some(e => e.field === 'clientId'));
  assert.equal(snapshotFingerprint(db.snap), before, 'snapshot незмінний після відмови');
  assert.deepEqual(db.snap.clients, [cardA], 'клієнти незмінні після відмови');
});

// ============================================================
// 5. Валідація clientId у спільній доменній дії
// ============================================================

test('saveProject: ghost clientId при створенні відхиляється без змін snapshot і clients', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  const before = snapshotFingerprint(db.snap);
  const result = await saveProject({
    name: 'Проєкт з примарою', type: 'IT', status: 'Очікування оплати', startDate: today(),
    budget: 50000, currency: 'UAH', clientName: 'Хтось', clientId: 'ghost-client',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some(e => e.field === 'clientId'));
  assert.equal(snapshotFingerprint(db.snap), before);
  assert.deepEqual(db.snap.clients, [cardA]);
  assert.equal(db.snap.projectsActive.length, 0);
});

test('saveProject: ghost clientId при редагуванні відхиляється без змін запису', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  const created = await saveProject({
    name: 'Чинний проєкт', type: 'IT', status: 'Очікування оплати', startDate: today(),
    budget: 50000, currency: 'UAH', clientName: cardA.name, clientId: cardA.id,
  });
  assert.equal(created.ok, true);
  const real = db.snap.projectsActive[0];
  const before = snapshotFingerprint(db.snap);
  const rejected = await saveProject({
    name: 'Чинний проєкт', type: 'IT', status: 'В роботі', startDate: today(),
    budget: 60000, currency: 'UAH', clientName: cardA.name, clientId: 'ghost-client',
  }, real.id);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.ok(rejected.errors.some(e => e.field === 'clientId'));
  assert.equal(snapshotFingerprint(db.snap), before, 'snapshot незмінний після відмови');
  assert.equal(db.snap.projectsActive[0].budget, 50000, 'запис не змінено');
});

test('saveProject: невалідний тип clientId відхиляється', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  const before = snapshotFingerprint(db.snap);
  const result = await saveProject({
    name: 'Проєкт', type: 'IT', status: 'Очікування оплати', startDate: today(),
    budget: 50000, currency: 'UAH', clientName: 'Анна (оновлено)',
    clientId: 12345 as unknown as string,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some(e => e.field === 'clientId' && /рядком/.test(e.message)));
  assert.equal(snapshotFingerprint(db.snap), before);
});

test('saveProject: ID, видалений між відкриттям форми і збереженням, відхиляється', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  const payload = {
    name: 'Копія', type: 'IT', status: 'Очікування оплати', startDate: today(),
    budget: 100000, currency: 'UAH',
    clientName: cardA.name, clientTelegram: '@anna', clientSource: 'Instagram',
    clientId: cardA.id,
  };
  // «Між відкриттям і збереженням» картку видалили:
  await store.saveCollection('clients', []);
  const before = snapshotFingerprint(db.snap);
  const result = await saveProject(payload);
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some(e => e.field === 'clientId'));
  assert.equal(snapshotFingerprint(db.snap), before);
  assert.equal(db.snap.projectsActive.length, 0);
});

test('saveProject не мутує переданий об’єкт/чернетку як побічний ефект', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  const input = {
    name: 'Проєкт', type: 'IT', status: 'Очікування оплати', startDate: today(),
    budget: 50000, currency: 'UAH',
    clientName: 'Анна',            // історичне ім'я — має лишитися в об'єкті викликача
    clientTelegram: '@old_ann',
    clientSource: 'Telegram',
    clientId: cardA.id,
  };
  const copy = structuredClone(input);
  const result = await saveProject(input);
  assert.equal(result.ok, true);
  assert.deepEqual(input, copy, 'вхідний об’єкт недоторканий');
  // Але в записі — дані картки (приведення в доменній дії).
  assert.equal(db.snap.projectsActive[0].clientName, 'Анна (оновлено)');
  assert.equal(db.snap.projectsActive[0].clientTelegram, '@anna');
});

test('saveProject: явний ID — картка джерело істини, її контакти не перезаписуються історичними', async () => {
  const db = await bootDb();
  const card = makeClient({ id: 'cli_x', name: 'Нове ім’я', telegram: '', source: '' });
  await store.saveCollection('clients', [card]);
  const result = await saveProject({
    name: 'Проєкт', type: 'IT', status: 'Очікування оплати', startDate: today(),
    budget: 50000, currency: 'UAH',
    clientName: 'Старе ім’я',
    clientTelegram: '@historical',
    clientSource: 'YouTube',
    clientId: card.id,
  });
  assert.equal(result.ok, true);
  const saved = db.snap.projectsActive[0];
  assert.equal(saved.clientId, card.id);
  assert.equal(saved.clientName, 'Нове ім’я', 'змішаний стан «ID A, ім’я B» не зберігається');
  assert.equal(saved.clientTelegram, '', 'порожні актуальні контакти не відновлюються зі старих значень');
  assert.equal(saved.clientSource, 'Інше');
  assert.deepEqual(db.snap.clients, [card], 'картку клієнта не перезаписано історичними значеннями');
});

test('звичайне створення і редагування проєктів не зламані', async () => {
  const db = await bootDb();
  // Створення без вибору картки: ім’я → підбір/створення картки, як і раніше.
  const created = await saveProject({
    name: 'Новий проєкт', type: 'Design', status: 'Очікування оплати', startDate: today(),
    budget: 20000, currency: 'UAH', clientName: 'Новий клієнт', clientTelegram: '@new',
  });
  assert.equal(created.ok, true);
  assert.equal(db.snap.projectsActive.length, 1);
  assert.equal(db.snap.clients.length, 1, 'картку створено за ім’ям');
  const projectId = db.snap.projectsActive[0].id;
  assert.equal(db.snap.projectsActive[0].clientId, db.snap.clients[0].id);
  // Редагування без клієнтських змін працює.
  const edited = await saveProject({
    name: 'Новий проєкт (оновлено)', type: 'Design', status: 'В роботі', startDate: today(),
    budget: 25000, currency: 'UAH', clientName: 'Новий клієнт', clientId: db.snap.clients[0].id,
  }, projectId);
  assert.equal(edited.ok, true);
  assert.equal(db.snap.projectsActive[0].name, 'Новий проєкт (оновлено)');
  assert.equal(db.snap.projectsActive[0].status, 'В роботі');
  assert.equal(db.snap.clients.length, 1, 'дубліката клієнта не з’явилось');
});

// ============================================================
// 1–2, 4. AI-копія: точний ID, явний вибір іншого клієнта
// ============================================================

test('AI-копія: чинний перейменований клієнт зберігає точний ID без нової картки', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  const source = completedSource();
  await store.saveCollection('projectsCompleted', [source]);
  const sourceBefore = structuredClone(db.snap.projectsCompleted[0]);

  const plan = normalizePlan({ domain: 'projects', action: 'create', fields: { copyFromId: source.id } }, db.snap);
  assert.equal(plan.copyClientMissing, false, 'картка джерела існує — уточнення не потрібне');
  assert.equal(plan.fields.clientId, 'cli_a');
  assert.equal(plan.fields.clientName, 'Анна (оновлено)', 'чернетка показує дані картки, не історичні');
  assert.equal(missingQuestions(plan, db.snap).length, 0);

  const signed: Plan = { ...plan, base: await fingerprint(db.snap) };
  const result = await executePlan(signed);
  assert.equal(result.kind, 'applied');
  assert.equal(db.snap.projectsActive.length, 1);
  assert.equal(db.snap.projectsActive[0].clientId, 'cli_a', 'точний ID без створення зайвої картки');
  assert.equal(db.snap.clients.length, 1, 'нова картка не створена');
  assert.deepEqual(db.snap.clients, [cardA], 'картку не перезаписано');
  assert.deepEqual(db.snap.projectsCompleted[0], sourceBefore, 'оригінал незмінний');
});

test('AI-копія: два клієнти з однаковим ім’ям розрізняються за точним ID', async () => {
  const db = await bootDb();
  const dup1 = makeClient({ id: 'cli_dup1', name: 'Дубль' });
  const dup2 = makeClient({ id: 'cli_dup2', name: 'Дубль' });
  // cli_dup2 перший у списку — саме його вибрав би пошук за ім’ям.
  await store.saveCollection('clients', [dup2, dup1]);
  const source = completedSource({ clientId: 'cli_dup1', clientName: 'Дубль' });
  await store.saveCollection('projectsCompleted', [source]);

  const plan = normalizePlan({ domain: 'projects', action: 'create', fields: { copyFromId: source.id } }, db.snap);
  assert.equal(plan.fields.clientId, 'cli_dup1', 'ID джерела, не перший збіг за ім’ям');
  const signed: Plan = { ...plan, base: await fingerprint(db.snap) };
  assert.equal((await executePlan(signed)).kind, 'applied');
  assert.equal(db.snap.projectsActive[0].clientId, 'cli_dup1');
  assert.equal(db.snap.clients.length, 2, 'жодної нової картки');
});

test('AI-копія: явний вибір іншого клієнта (clientId) зберігає саме його', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA, cardB]);
  const source = completedSource();
  await store.saveCollection('projectsCompleted', [source]);

  // Дозволені overrides копії пропускають новий clientId і не повертають початковий.
  const plan = normalizePlan(
    { domain: 'projects', action: 'create', fields: { copyFromId: source.id, clientId: 'cli_b' } },
    db.snap,
  );
  assert.equal(plan.fields.clientId, 'cli_b', 'allowlist копії не відкидає новий clientId');
  assert.equal(plan.fields.clientName, 'Борис', 'дані обраної картки');
  const signed: Plan = { ...plan, base: await fingerprint(db.snap) };
  assert.equal((await executePlan(signed)).kind, 'applied');
  assert.equal(db.snap.projectsActive[0].clientId, 'cli_b');
  assert.equal(db.snap.clients.length, 2, 'нова картка не створена');
  assert.deepEqual(db.snap.clients, [cardA, cardB]);
});

test('AI-копія: вибір клієнта за точним ім’ям у overrides теж прив’язує того самого', () => {
  const s = emptySnapshot();
  s.clients = [cardA, cardB];
  s.projectsCompleted = [completedSource()];
  const plan = normalizePlan(
    { domain: 'projects', action: 'create', fields: { copyFromId: 'prj_src', clientName: 'Борис' } },
    s,
  );
  assert.equal(plan.fields.clientId, 'cli_b');
  assert.equal(plan.copyClientMissing, false);
});

test('AI-копія: невідомий clientId у overrides відхиляється до будь-якого запису', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  await store.saveCollection('projectsCompleted', [completedSource()]);
  const before = snapshotFingerprint(db.snap);
  const commits0 = db.commits;
  assert.throws(
    () => normalizePlan(
      { domain: 'projects', action: 'create', fields: { copyFromId: 'prj_src', clientId: 'ghost-client' } },
      db.snap,
    ),
    /не знайдено/,
  );
  assert.equal(snapshotFingerprint(db.snap), before, 'нормалізація нічого не пише');
  assert.equal(db.commits, commits0, 'жодного нового запису');
});

test('AI-копія: невідома назва клієнта в overrides не лишає початковий ID мовчки', () => {
  const s = emptySnapshot();
  s.clients = [cardA];
  s.projectsCompleted = [completedSource()];
  const plan = normalizePlan(
    { domain: 'projects', action: 'create', fields: { copyFromId: 'prj_src', clientName: 'Невідомий клієнт' } },
    s,
  );
  // Явного вибору немає — система зупиняється на уточненні, ID не вгадує.
  assert.equal(plan.copyClientMissing, true);
  assert.ok(!('clientId' in plan.fields), 'видалений/невідомий зв’язок не підставляється');
  assert.ok(missingQuestions(plan, s).some(q => q.key === 'client'));
});

// ============================================================
// 6. Скопійовані історичні контакти не змінюють чинну картку
// ============================================================

test('AI-копія: порожні актуальні контакти картки не відновлюються зі старих значень', async () => {
  const db = await bootDb();
  const emptyCard = makeClient({ id: 'cli_empty', name: 'Ема', telegram: '', source: '' });
  await store.saveCollection('clients', [emptyCard]);
  const source = completedSource({
    clientId: 'cli_empty', clientName: 'Ема (стара)', clientTelegram: '@old_ema', clientSource: 'YouTube',
  });
  await store.saveCollection('projectsCompleted', [source]);

  const plan = normalizePlan({ domain: 'projects', action: 'create', fields: { copyFromId: source.id } }, db.snap);
  assert.equal(plan.fields.clientTelegram, '', 'у чернетці вже порожні актуальні контакти');
  const signed: Plan = { ...plan, base: await fingerprint(db.snap) };
  assert.equal((await executePlan(signed)).kind, 'applied');

  const saved = db.snap.projectsActive[0];
  assert.equal(saved.clientTelegram, '', 'історичний @old_ema не воскресає');
  assert.deepEqual(db.snap.clients, [emptyCard], 'картку не змінено');
});

// ============================================================
// 7. Видалений клієнт: уточнення → вибір або явне створення
// ============================================================

test('видалений клієнт: уточнення до запису, без жодного запису', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardB]);
  const source = completedSource({ clientId: 'cli_gone' });
  await store.saveCollection('projectsCompleted', [source]);
  const before = snapshotFingerprint(db.snap);
  const commits0 = db.commits;

  const plan = normalizePlan({ domain: 'projects', action: 'create', fields: { copyFromId: source.id } }, db.snap);
  assert.equal(plan.copyClientMissing, true, 'прапорець видаленого клієнта виставлено');
  // Логіка маршруту: поки є питання — чернетка не створюється (лише clarify).
  const questions = missingQuestions(plan, db.snap);
  const wouldCreateDraft = questions.length === 0;
  assert.equal(wouldCreateDraft, false, 'чернетка не створюється до явного вибору');
  assert.ok(questions.some(q => q.key === 'client'));
  assert.equal(snapshotFingerprint(db.snap), before, 'нічого не записано');
  assert.equal(db.commits, commits0, 'жодного нового запису');
});

test('видалений клієнт: повторна нормалізація і confirm не втрачають перевірку', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardB]);
  const source = completedSource({ clientId: 'cli_gone' });
  await store.saveCollection('projectsCompleted', [source]);
  const commits0 = db.commits;

  const raw = { domain: 'projects', action: 'create', fields: { copyFromId: source.id } };
  const first = normalizePlan(raw, db.snap);
  const second = normalizePlan(raw, db.snap);
  assert.equal(first.copyClientMissing, true);
  assert.equal(second.copyClientMissing, true, 'повторна нормалізація не втрачає прапорець');

  // Підписання (base) не впливає на прапорець, а confirm-нормалізація
  // повертає те саме уточнення — запис без вибору неможливий.
  const signed: Plan = { ...first, base: await fingerprint(db.snap) };
  const atConfirm = normalizePlan({ ...signed, fields: { ...signed.fields } }, db.snap);
  assert.equal(atConfirm.copyClientMissing, true);
  assert.ok(missingQuestions(atConfirm, db.snap).some(q => q.key === 'client'),
    'confirm-перевірка повертає уточнення, а не запис');
  assert.equal(db.commits, commits0, 'жодного нового запису');
});

test('видалений клієнт: вибір чинного клієнта у відповіді завершує копіювання', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardB]);
  const source = completedSource({ clientId: 'cli_gone' });
  await store.saveCollection('projectsCompleted', [source]);

  // Відповідь власника: конкретний чинний клієнт → модель повторює чернетку з clientId.
  const plan = normalizePlan(
    { domain: 'projects', action: 'create', fields: { copyFromId: source.id, clientId: 'cli_b' } },
    db.snap,
  );
  assert.equal(plan.copyClientMissing, false, 'явний вибір знімає уточнення');
  assert.equal(missingQuestions(plan, db.snap).length, 0);
  const signed: Plan = { ...plan, base: await fingerprint(db.snap) };
  assert.equal((await executePlan(signed)).kind, 'applied');
  assert.equal(db.snap.projectsActive.length, 1);
  assert.equal(db.snap.projectsActive[0].clientId, 'cli_b');
  assert.equal(db.snap.clients.length, 1, 'жодної зайвої картки');
});

test('видалений клієнт: явне створення картки окремою дією, потім копія; без дубліката', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardB]);
  const source = completedSource({ clientId: 'cli_gone' });
  await store.saveCollection('projectsCompleted', [source]);

  // Крок 1: окрема підтверджувана дія створення клієнта.
  const clientPlan = normalizePlan(
    { domain: 'clients', action: 'create', fields: { name: 'Новий клієнт' } },
    db.snap,
  );
  const signedClient: Plan = { ...clientPlan, base: await fingerprint(db.snap) };
  const clientResult = await executePlan(signedClient);
  assert.equal(clientResult.kind, 'applied');
  assert.equal(db.snap.clients.length, 2, 'створено рівно одну картку');
  const newId = db.snap.clients[1].id;

  // Крок 2: нова чернетка копії з ID створеної картки.
  const plan = normalizePlan(
    { domain: 'projects', action: 'create', fields: { copyFromId: source.id, clientId: newId } },
    db.snap,
  );
  assert.equal(plan.copyClientMissing, false);
  const signedCopy: Plan = { ...plan, base: await fingerprint(db.snap) };
  assert.equal((await executePlan(signedCopy)).kind, 'applied');
  assert.equal(db.snap.projectsActive.length, 1);
  assert.equal(db.snap.projectsActive[0].clientId, newId);
  assert.equal(db.snap.clients.length, 2, 'без третьої картки');

  // Повторне підтвердження того самого підписаного плану не дублює.
  assert.equal((await executePlan(signedCopy)).kind, 'error');
  assert.equal(db.snap.projectsActive.length, 1);
  assert.equal(db.snap.clients.length, 2);
});

// ============================================================
// 8. copyFromId: службова семантика create/update/null/порожнього
// ============================================================

test('copyFromId: update з цим полем не записує його в проєкт', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  const project = makeProject({ id: 'prj_upd', clientId: cardA.id, clientName: cardA.name });
  await store.saveCollection('projectsActive', [project]);

  const plan = normalizePlan(
    { domain: 'projects', action: 'update', recordId: project.id, fields: { copyFromId: 'ghost-source', budget: 200000 } },
    db.snap,
  );
  assert.ok(!('copyFromId' in plan.fields), 'службовий параметр вилучено ще до валідації');
  assert.equal(plan.fields.budget, 200000);
  const signed: Plan = { ...plan, base: await fingerprint(db.snap) };
  assert.equal((await executePlan(signed)).kind, 'applied');
  assert.ok(!('copyFromId' in db.snap.projectsActive[0]), 'copyFromId не зберігається в проєкті');
  assert.equal(db.snap.projectsActive[0].budget, 200000, 'змінено лише очікуване поле');
  assert.deepEqual(db.snap.clients, [cardA], 'клієнтів не змінено');
});

test('copyFromId: null і порожнє значення за визначеною семантикою', () => {
  const s = emptySnapshot();
  s.clients = [cardA];
  // null → службова команда відсутня, звичайне створення з переданими полями.
  const withNull = normalizePlan(
    { domain: 'projects', action: 'create', fields: { name: 'Просто створення', type: 'IT', budget: 1000, copyFromId: null } },
    s,
  );
  assert.ok(!('copyFromId' in withNull.fields));
  assert.equal(withNull.fields.name, 'Просто створення', 'копіювання не активується');
  assert.ok(!('prepayment' in withNull.fields) || withNull.fields.prepayment === 0);
  // Порожній рядок → зрозуміла відмова.
  assert.throws(
    () => normalizePlan({ domain: 'projects', action: 'create', fields: { name: 'X', type: 'IT', budget: 1, copyFromId: '' } }, s),
    /порожній/,
  );
});

// ============================================================
// 9. AI-update: явна зміна зв’язку з клієнтом
// ============================================================

test('AI-update: зміна клієнта на іншу наявну картку міняє зв’язок явно', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA, cardB]);
  const project = makeProject({ id: 'prj_a', clientId: cardA.id, clientName: cardA.name });
  await store.saveCollection('projectsActive', [project]);

  const plan = normalizePlan(
    { domain: 'projects', action: 'update', recordId: project.id, fields: { clientName: 'Борис' } },
    db.snap,
  );
  assert.equal(plan.fields.clientId, 'cli_b', 'зв’язок міняється видимо в чернетці');
  assert.equal(plan.fields.clientName, 'Борис');
  const signed: Plan = { ...plan, base: await fingerprint(db.snap) };
  assert.equal((await executePlan(signed)).kind, 'applied');
  assert.equal(db.snap.projectsActive[0].clientId, 'cli_b', 'зв’язок реально змінено, не залишено старий ID');
  assert.deepEqual(db.snap.clients, [cardA, cardB], 'картку Бориса не перезаписано');
});

test('AI-update: невідома назва клієнта без явного clientId відхиляється до запису', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  const project = makeProject({ id: 'prj_a', clientId: cardA.id, clientName: cardA.name });
  await store.saveCollection('projectsActive', [project]);
  const before = snapshotFingerprint(db.snap);

  assert.throws(
    () => normalizePlan(
      { domain: 'projects', action: 'update', recordId: project.id, fields: { clientName: 'Невідомий' } },
      db.snap,
    ),
    /явний clientId/,
  );
  assert.equal(snapshotFingerprint(db.snap), before, 'нормалізація нічого не пише');
  assert.equal(db.snap.projectsActive[0].clientId, cardA.id);
});

test('AI-update: лише clientName, що збігається з карткою, приводиться до картки без відмови', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  // Історичне ім'я в проєкті відрізняється від перейменованої картки.
  const project = makeProject({ id: 'prj_a', clientId: cardA.id, clientName: 'Анна' });
  await store.saveCollection('projectsActive', [project]);

  const plan = normalizePlan(
    { domain: 'projects', action: 'update', recordId: project.id, fields: { clientName: cardA.name } },
    db.snap,
  );
  assert.equal(plan.fields.clientId, cardA.id);
  assert.equal(plan.fields.clientName, cardA.name);
  assert.equal(missingQuestions(plan, db.snap).length, 0);
  const signed: Plan = { ...plan, base: await fingerprint(db.snap) };
  assert.equal((await executePlan(signed)).kind, 'applied');
  assert.equal(db.snap.projectsActive[0].clientId, cardA.id, 'ID не збито');
});

test('AI-update: клієнтські поля не розходяться з карткою — чернетка показує дані картки', () => {
  const s = emptySnapshot();
  s.clients = [cardA];
  s.projectsActive = [makeProject({ id: 'prj_a', clientId: cardA.id, clientName: cardA.name })];
  const plan = normalizePlan(
    { domain: 'projects', action: 'update', recordId: 'prj_a', fields: { clientTelegram: '@mdl' } },
    s,
  );
  assert.equal(plan.fields.clientTelegram, cardA.telegram, 'контакти беруться з картки, а не лишаються розійдені');
});

test('AI: створення проєкту з невідомим clientId відхиляється до запису', async () => {
  const db = await bootDb();
  await store.saveCollection('clients', [cardA]);
  const before = snapshotFingerprint(db.snap);
  const commits0 = db.commits;
  assert.throws(
    () => normalizePlan(
      { domain: 'projects', action: 'create', fields: { name: 'X', type: 'IT', budget: 1000, clientName: 'Хтось', clientId: 'ghost-client' } },
      db.snap,
    ),
    /не знайдено/,
  );
  assert.equal(snapshotFingerprint(db.snap), before);
  assert.equal(db.commits, commits0, 'жодного нового запису');
});

// ============================================================
// Додатково: prefill форми копії та попередження (джерело consent-UI)
// ============================================================

test('копія з видаленим клієнтом: без ID у prefill і з попередженням для форми', () => {
  const source = completedSource({ clientId: 'cli_gone' });
  const { prefill, missing } = initialProjectForCopy(source, {
    clients: [cardB], specialists: [], partners: [],
  });
  assert.equal(missing.client, true, 'джерело для прапорця copyNeedsClientChoice');
  assert.ok(!('clientId' in prefill), 'видалений ID не підставляється у форму');
  assert.equal(prefill.clientName, 'Анна', 'історичне ім’я лишається текстом');
  const warnings = copyMissingWarnings(source, missing);
  assert.ok(warnings.some(w => /Картку клієнта/.test(w)));
});
