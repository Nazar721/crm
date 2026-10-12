import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialProjectForCopy,
  pickCopyOverrides,
  copyMissingWarnings,
  COPY_CONDITION_FIELDS,
} from '@/lib/copy-project';
import { normalizePlan, fingerprint, type Plan } from '@/lib/assistant/plan';
import { executePlan } from '@/lib/assistant/executor';
import { SupabaseDataSource } from '@/lib/datasource/supabase';
import * as store from '@/lib/store';
import { today } from '@/lib/utils';
import { clearAll, emptySnapshot, makeProject, makeClient } from './helpers';
import type { Partner, Project, Specialist } from '@/types';

// ---- Фейкова remote-база (той самий контракт, що й в assistant-live.test.ts) ----
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

const specialist: Specialist = { id: 'sp1', name: 'Олег', specialization: 'Frontend' };
const partner: Partner = { id: 'pt1', name: 'Партнер', services: 'Дизайн' };
const client = makeClient({ id: 'cli1', name: 'Клієнт А' });

/** Повністю заповнений завершений проєкт із оплатами, виплатами й архівними даними. */
function completedSource(overrides: Partial<Project> = {}): Project {
  return {
    ...makeProject({
      id: 'prj_src',
      name: 'Готовий сайт',
      type: 'IT',
      status: 'Завершено',
      budget: 120000,
      currency: 'USD',
      prepayment: 60000,
      paidToSpecialist: 30000,
      profitTaken: 5000,
      myPercent: 30,
      fop: 10,
      partnerCommission: 5,
      bank: 'mono',
      startDate: '2026-01-05',
      workStartDate: '2026-01-06',
      workedDays: 12,
      deadlineDays: 14,
      endDate: '2026-02-01',
      finishDate: '2026-02-01',
      paymentDate: '2026-02-03',
      completedAt: 1770000000000,
      days: 27,
      specialistCost: 41000,
      description: 'Лендінг із каталогом',
      clientId: 'cli1',
      clientName: 'Клієнт А',
      clientTelegram: '@clienta',
      clientSource: 'Telegram',
      developerId: 'sp1',
      partnerId: 'pt1',
    }),
    ...overrides,
  } as Project;
}

// Ключі, яким дозволено лишатися в prefill окрім дозволених «умов».
const STRUCTURAL_KEYS = new Set(['status', 'startDate', 'deadlineDays', 'clientId']);

test('копіювання завершеного проєкту переносить лише дозволені умови', () => {
  const source = completedSource();
  const { prefill, missing } = initialProjectForCopy(source, {
    clients: [client], specialists: [specialist], partners: [partner],
  });

  // Дозволені умови переносяться дослівно.
  assert.equal(prefill.name, 'Готовий сайт');
  assert.equal(prefill.type, 'IT');
  assert.equal(prefill.description, 'Лендінг із каталогом');
  assert.equal(prefill.budget, 120000);
  assert.equal(prefill.currency, 'USD');
  assert.equal(prefill.myPercent, 30);
  assert.equal(prefill.fop, 10);
  assert.equal(prefill.partnerCommission, 5);
  assert.equal(prefill.deadlineDays, 14);
  assert.equal(prefill.clientName, 'Клієнт А');
  assert.equal(prefill.clientTelegram, '@clienta');
  assert.equal(prefill.clientSource, 'Telegram');
  assert.equal(prefill.developerId, 'sp1');
  assert.equal(prefill.partnerId, 'pt1');

  // Новий стан і старт — типові для нового проєкту.
  assert.equal(prefill.status, 'Очікування оплати');
  assert.equal(prefill.startDate, today());

  // Жодна пов'язана сутність не втрачена.
  assert.deepEqual(missing, { client: false, specialist: false, partner: false });

  // Allowlist: у prefill немає жодного зайвого/забороненого ключа.
  for (const key of Object.keys(prefill)) {
    const allowed = COPY_CONDITION_FIELDS.includes(key as never) || STRUCTURAL_KEYS.has(key);
    assert.ok(allowed, `неочікуване поле в prefill: ${key}`);
  }
});

test('видалені сутності: попередження та відсутність застарілих ID, умови збережені', () => {
  const source = completedSource({ clientId: 'cli_gone', developerId: 'sp_gone', partnerId: 'pt_gone' });
  const { prefill, missing } = initialProjectForCopy(source, {
    clients: [client], specialists: [specialist], partners: [partner],
  });

  assert.deepEqual(missing, { client: true, specialist: true, partner: true });
  // Застарілі ID не підставляються — щоб збереження не вказало на неіснуючий запис.
  assert.ok(!('clientId' in prefill));
  assert.ok(!('developerId' in prefill));
  assert.ok(!('partnerId' in prefill));
  // Але ручні дозволені поля (текст клієнта тощо) не губяться.
  assert.equal(prefill.clientName, 'Клієнт А');
  assert.equal(prefill.budget, 120000);

  const warnings = copyMissingWarnings(source, missing);
  assert.equal(warnings.length, 3);
  assert.ok(warnings[0].includes('Клієнт А'));
  assert.ok(warnings[1].includes('фахівця'));
  assert.ok(warnings[2].includes('партнера'));
});

test('pickCopyOverrides лишає лише дозволені умови та не переносить порожні значення', () => {
  const out = pickCopyOverrides({
    name: 'Перейменований',
    budget: 150000,
    myPercent: 40,
    description: '',
    currency: 'EUR',
    // Скинуті / службові поля мають бути відкинуті:
    prepayment: 9999,
    paidToSpecialist: 9999,
    profitTaken: 9999,
    bank: 'mono',
    status: 'Завершено',
    startDate: '2020-01-01',
    copyFromId: 'prj_x',
  } as Record<string, unknown>);

  assert.deepEqual(out, { name: 'Перейменований', budget: 150000, myPercent: 40, currency: 'EUR' });
  for (const key of ['prepayment', 'paidToSpecialist', 'profitTaken', 'bank', 'status', 'startDate', 'copyFromId']) {
    assert.ok(!(key in out), `override не повинен містити ${key}`);
  }
});

test('AI-копія: чиста підготовка полів з нульовими оплатами, без службового copyFromId', () => {
  const s = emptySnapshot();
  s.clients = [client];
  s.specialists = [specialist];
  s.partners = [partner];
  s.projectsCompleted = [completedSource()];

  const plan = normalizePlan(
    { domain: 'projects', action: 'create', fields: { copyFromId: 'prj_src' } },
    s,
  );

  assert.equal(plan.fields.name, 'Готовий сайт');
  assert.equal(plan.fields.type, 'IT');
  assert.equal(plan.fields.budget, 120000);
  assert.equal(plan.fields.status, 'Очікування оплати');
  assert.equal(plan.fields.startDate, today());
  // Оплати/виплати/прибуток явно нульові.
  assert.equal(plan.fields.prepayment, 0);
  assert.equal(plan.fields.paidToSpecialist, 0);
  assert.equal(plan.fields.profitTaken, 0);
  // Службове поле не просочується в дані проєкту.
  assert.ok(!('copyFromId' in plan.fields));
  // Старі дати не переносяться.
  assert.ok(!('endDate' in plan.fields));
  assert.ok(!('finishDate' in plan.fields));
  assert.ok(!('paymentDate' in plan.fields));
  assert.ok(!('workStartDate' in plan.fields));
});

test('копія завжди скидає оплати, виплати, прибуток, банк і всі старі дати', () => {
  const source = completedSource();
  const { prefill } = initialProjectForCopy(source, {
    clients: [client], specialists: [specialist], partners: [partner],
  });

  // Скинуті поля не переносяться навіть коли в оригіналі заповнені —
  // allowlist означає, що цих ключів у prefill просто немає.
  const reset = [
    'id', 'createdAt', 'prepayment', 'paidToSpecialist', 'profitTaken',
    'bank', 'endDate', 'finishDate', 'paymentDate', 'workStartDate',
    'workedDays', 'days', 'completedAt', 'specialistCost',
  ];
  for (const key of reset) {
    assert.ok(!(key in prefill), `скинуте поле не повинно потрапляти в копію: ${key}`);
  }
  // Головне: оригінал залишається недоторканим (чиста функція не мутує вхід).
  assert.equal(source.prepayment, 60000);
  assert.equal(source.profitTaken, 5000);
  assert.equal(source.bank, 'mono');
});

test('AI-копія: явні умови замінюють умови копії, оплати залишаються нульовими', () => {
  const s = emptySnapshot();
  s.clients = [client]; s.specialists = [specialist]; s.partners = [partner];
  s.projectsCompleted = [completedSource()];

  // Модель намагається і змінити умови, І «протягнути» оплату та статус «Завершено».
  const plan = normalizePlan(
    {
      domain: 'projects', action: 'create',
      fields: { copyFromId: 'prj_src', name: 'Нове ім’я', budget: 200000, prepayment: 5000, status: 'Завершено', bank: 'mono' },
    },
    s,
  );

  assert.equal(plan.fields.name, 'Нове ім’я');
  assert.equal(plan.fields.budget, 200000);
  // Скинуті поля перемагає система: оплата 0, статус лишається «Очікування оплати», банку немає.
  assert.equal(plan.fields.prepayment, 0);
  assert.equal(plan.fields.status, 'Очікування оплати');
  assert.ok(!('bank' in plan.fields));
});

test('AI-копія: невідомий початковий проєкт відкидається', () => {
  const s = emptySnapshot();
  assert.throws(
    () => normalizePlan({ domain: 'projects', action: 'create', fields: { copyFromId: 'ghost' } }, s),
    /не знайдено/,
  );
});

test('AI-копія: підготовка чернетки не робить записів', async () => {
  clearAll();
  const db = database();
  await store.initStore(new SupabaseDataSource(db.rpc));
  await store.saveCollection('projectsCompleted', [completedSource()]);
  const before = db.commits;

  const plan = normalizePlan(
    { domain: 'projects', action: 'create', fields: { copyFromId: 'prj_src' } },
    db.snap,
  );
  // Побудова підписаної чернетки — це ще не застосування.
  const signed: Plan = { ...plan, base: await fingerprint(db.snap) };
  assert.equal(db.commits, before, 'підготовка чернетки не повинна писати в базу');
  assert.ok(signed.fields.copyFromId === undefined);
});

test('AI-копія: підтвердження створює рівно один новий активний проєкт; оригінал недоторканий', async () => {
  clearAll();
  const db = database();
  await store.initStore(new SupabaseDataSource(db.rpc));
  const source = completedSource();
  await store.saveCollection('projectsCompleted', [source]);
  const sourceBefore = structuredClone(db.snap.projectsCompleted[0]);

  const plan = normalizePlan(
    { domain: 'projects', action: 'create', fields: { copyFromId: source.id } },
    db.snap,
  );
  const signed: Plan = { ...plan, base: await fingerprint(db.snap) };
  const result = await executePlan(signed);
  assert.equal(result.kind, 'applied');
  assert.ok(result.recordId, 'повертає ID нового запису');

  // Новий активний проєкт створено рівно один.
  assert.equal(db.snap.projectsActive.length, 1);
  const created = db.snap.projectsActive[0];
  assert.notEqual(created.id, source.id, 'новий ID');
  assert.equal(created.name, 'Готовий сайт');
  assert.equal(created.budget, 120000);
  assert.equal(created.prepayment, 0);
  assert.equal(created.paidToSpecialist, 0);
  assert.equal(created.profitTaken, 0);
  assert.equal(created.status, 'Очікування оплати');
  assert.equal(created.startDate, today());

  // Оригінал у завершених не змінився (byte-for-byte по ключах).
  assert.deepEqual(db.snap.projectsCompleted[0], sourceBefore);

  // Той самий підписаний стан не може виконатись повторно.
  assert.equal((await executePlan(signed)).kind, 'error');
});

