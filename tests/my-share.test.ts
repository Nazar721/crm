import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, bootStore, emptySnapshot } from './helpers';
import { DEFAULT_MY_SHARE, autoMyPercent, resolveMyShare } from '@/lib/my-share';
import { validatePositiveNumber, validatePercent } from '@/lib/validate';
import { saveSpecialist, saveProject, saveRates, validateSpecialistInput } from '@/lib/actions';
import { validateBackup } from '@/lib/validate-backup';
import { applyImport } from '@/lib/importer';
import { normalizePlan, fingerprint } from '@/lib/assistant/plan';
import { executePlan } from '@/lib/assistant/executor';
import { LocalDataSource } from '@/lib/datasource/local';
import { EXPORT_FORMAT_ID, EXPORT_SCHEMA_VERSION, type ExportPayload, type Project, type Specialist } from '@/types';
import * as store from '@/lib/store';

const settings = { usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' as const };

function specialistPayload(specialists: unknown[]): ExportPayload {
  return {
    app: EXPORT_FORMAT_ID,
    version: EXPORT_SCHEMA_VERSION,
    exportedAt: '2026-04-01T12:00:00.000Z',
    data: {
      projectsActive: [],
      projectsCompleted: [],
      clients: [],
      specialists,
      partners: [],
      transactions: [],
      personalDebts: [],
      savings: [],
    },
    financeSettings: settings,
  } as ExportPayload;
}

function baseProjectInput(overrides: Partial<Project> = {}): Partial<Project> {
  return {
    name: 'Тестовий проєкт',
    type: 'IT',
    status: 'Очікування оплати',
    startDate: '2026-01-05',
    clientName: 'Клієнт',
    budget: 2999,
    currency: 'UAH',
    ...overrides,
  };
}

// ============================================================
// Таблиця приймання: початкове правило 3 000 / 30% / 25%
// ============================================================

test('критерії приймання: 2 999/3 000 → 30%, 3 000,01/5 000 → 25%', () => {
  const spec: Partial<Specialist> = {};
  assert.equal(autoMyPercent(spec, 2999, 'UAH', settings), 30);
  assert.equal(autoMyPercent(spec, 3000, 'UAH', settings), 30);
  assert.equal(autoMyPercent(spec, 3000.01, 'UAH', settings), 25);
  assert.equal(autoMyPercent(spec, 5000, 'UAH', settings), 25);
  assert.deepEqual(DEFAULT_MY_SHARE, { threshold: 3000, percentUpTo: 30, percentAbove: 25 });
  assert.deepEqual(resolveMyShare(null), DEFAULT_MY_SHARE);
});

test('різні фахівці можуть мати різні правила', () => {
  const a = { myShareThreshold: 1000, mySharePercentUpTo: 40, mySharePercentAbove: 20 };
  const b = { myShareThreshold: 10000, mySharePercentUpTo: 35, mySharePercentAbove: 15 };
  assert.equal(autoMyPercent(a, 999, 'UAH', settings), 40);
  assert.equal(autoMyPercent(a, 1001, 'UAH', settings), 20);
  assert.equal(autoMyPercent(b, 9999, 'UAH', settings), 35);
  assert.equal(autoMyPercent(b, 10001, 'UAH', settings), 15);
});

test('валютний бюджет порівнюється з порогом після конвертації', () => {
  // usdRate 41: 73 USD = 2 993 ₴ → 30%; 74 USD = 3 034 ₴ → 25%.
  assert.equal(autoMyPercent({}, 73, 'USD', settings), 30);
  assert.equal(autoMyPercent({}, 74, 'USD', settings), 25);
  // Зміна курсу впливає на результат.
  const faster = { ...settings, usdRate: 50 };
  assert.equal(autoMyPercent({}, 73, 'USD', faster), 25);
});

test('без фахівця або з некоректним бюджетом відсоток не підставляється', () => {
  assert.equal(autoMyPercent(undefined, 5000, 'UAH', settings), null);
  assert.equal(autoMyPercent(null, 5000, 'UAH', settings), null);
  assert.equal(autoMyPercent({}, '', 'UAH', settings), null);
  assert.equal(autoMyPercent({}, '  ', 'UAH', settings), null);
  assert.equal(autoMyPercent({}, 'abc', 'UAH', settings), null);
  assert.equal(autoMyPercent({}, -1, 'UAH', settings), null);
  assert.equal(autoMyPercent({}, Number.NaN, 'UAH', settings), null);
  assert.equal(autoMyPercent({}, Number.POSITIVE_INFINITY, 'UAH', settings), null);
  assert.equal(autoMyPercent({}, undefined, 'UAH', settings), null);
});

test('відсутні або некоректні налаштування фахівця → початкове правило', () => {
  assert.deepEqual(resolveMyShare(undefined), DEFAULT_MY_SHARE);
  assert.deepEqual(resolveMyShare({}), DEFAULT_MY_SHARE);
  assert.deepEqual(
    resolveMyShare({ myShareThreshold: 0, mySharePercentUpTo: -5, mySharePercentAbove: 101 }),
    DEFAULT_MY_SHARE,
  );
  assert.deepEqual(resolveMyShare({ myShareThreshold: 5000 }), {
    threshold: 5000,
    percentUpTo: 30,
    percentAbove: 25,
  });
});

// ============================================================
// Валідація: форма і доменні дії
// ============================================================

test('валідація налаштувань: додатний поріг, відсотки 0–100, без порожніх/NaN/Infinity', () => {
  const base = {
    name: 'Олег',
    specialization: 'Frontend',
    myShareThreshold: '3000',
    mySharePercentUpTo: '30',
    mySharePercentAbove: '25',
  };
  assert.deepEqual(validateSpecialistInput(base), []);

  const bad = (patch: Record<string, unknown>) => validateSpecialistInput({ ...base, ...patch });
  assert.ok(bad({ myShareThreshold: '' }).some(e => e.field === 'myShareThreshold'));
  assert.ok(bad({ myShareThreshold: 0 }).length > 0);
  assert.ok(bad({ myShareThreshold: -5 }).length > 0);
  assert.ok(bad({ myShareThreshold: 'abc' }).length > 0);
  assert.ok(bad({ myShareThreshold: Number.NaN }).length > 0);
  assert.ok(bad({ myShareThreshold: Number.POSITIVE_INFINITY }).length > 0);
  assert.ok(bad({ mySharePercentUpTo: 101 }).length > 0);
  assert.ok(bad({ mySharePercentUpTo: -1 }).length > 0);
  assert.ok(bad({ mySharePercentUpTo: '' }).length > 0);
  assert.ok(bad({ mySharePercentAbove: Number.NaN }).length > 0);
  assert.ok(bad({ name: '' }).some(e => e.field === 'name'));
  assert.ok(bad({ specialization: '' }).some(e => e.field === 'specialization'));
  // Межі дозволені: 0 і 100 включно, дробовий поріг.
  assert.deepEqual(
    validateSpecialistInput({ ...base, myShareThreshold: '3000.01', mySharePercentUpTo: 0, mySharePercentAbove: 100 }),
    [],
  );

  // Окремі валідатори теж дотримуються правил.
  assert.ok(validatePositiveNumber(0, 't', 'Поріг').length > 0);
  assert.equal(validatePositiveNumber(0.01, 't', 'Поріг').length, 0);
  assert.ok(validatePercent(101, 'p', 'Відсоток', { required: true }).length > 0);
  assert.ok(validatePercent('', 'p', 'Відсоток', { required: true }).length > 0);
  assert.equal(validatePercent('', 'p', 'Відсоток').length, 0);
});

// ============================================================
// Збереження (спільний адаптер сховища)
// ============================================================

test('saveSpecialist зберігає налаштування; відсутні → початкове правило; некоректні → відмова', async () => {
  clearAll();
  await bootStore();

  // AI-подібний виклик без налаштувань → початкове правило.
  const created = await saveSpecialist({ name: 'Олег', specialization: 'Frontend' });
  assert.ok(created.ok);
  const first = store.getSnapshot().specialists[0];
  assert.equal(first.myShareThreshold, 3000);
  assert.equal(first.mySharePercentUpTo, 30);
  assert.equal(first.mySharePercentAbove, 25);

  // Власне правило збережено як числа (рядки з форми нормалізуються).
  const custom = await saveSpecialist({
    name: 'Іра',
    specialization: 'Design',
    myShareThreshold: '5000',
    mySharePercentUpTo: '40',
    mySharePercentAbove: '10',
  });
  assert.ok(custom.ok);
  const second = store.getSnapshot().specialists[1] as Specialist;
  assert.equal(second.myShareThreshold, 5000);
  assert.equal(second.mySharePercentUpTo, 40);
  assert.equal(second.mySharePercentAbove, 10);
  assert.equal(typeof second.myShareThreshold, 'number');

  // Некоректні значення відхиляються доменною дією.
  const invalid = await saveSpecialist({
    name: 'Х',
    specialization: 'Dev',
    myShareThreshold: 0,
    mySharePercentUpTo: 30,
    mySharePercentAbove: 25,
  });
  assert.equal(invalid.ok, false);
  assert.equal(store.getSnapshot().specialists.length, 2);

  // Редагування оновлює лише фахівця.
  const updated = await saveSpecialist(
    { name: 'Іра', specialization: 'Design', myShareThreshold: 7000, mySharePercentUpTo: 50, mySharePercentAbove: 5 },
    second.id,
  );
  assert.ok(updated.ok);
  assert.equal(store.getSnapshot().specialists[1].myShareThreshold, 7000);
  assert.equal(store.getSnapshot().specialists[0].myShareThreshold, 3000);
});

test('налаштування зберігаються після перезавантаження (той самий адаптер сховища)', async () => {
  clearAll();
  await bootStore();
  const saved = await saveSpecialist({
    name: 'Олег',
    specialization: 'Frontend',
    myShareThreshold: 4500,
    mySharePercentUpTo: 40,
    mySharePercentAbove: 15,
  });
  assert.ok(saved.ok);

  // «Перезавантаження»: скидаємо пам'ять і знову читаємо той самий storage.
  store.resetStoreForTests();
  await bootStore(new LocalDataSource());
  const spec = store.getSnapshot().specialists[0];
  assert.equal(spec.myShareThreshold, 4500);
  assert.equal(spec.mySharePercentUpTo, 40);
  assert.equal(spec.mySharePercentAbove, 15);
});


// ============================================================
// Автоматичне заповнення у проєкті (доменна дія)
// ============================================================

test('проєкт без явного myPercent отримує правило фахівця; явний відсоток зберігається', async () => {
  clearAll();
  await bootStore();
  const created = await saveSpecialist({ name: 'Олег', specialization: 'Frontend' });
  assert.ok(created.ok);
  const spec = store.getSnapshot().specialists[0];

  const below = await saveProject(baseProjectInput({ developerId: spec.id }));
  assert.ok(below.ok);
  assert.equal(store.getSnapshot().projectsActive[0].myPercent, 30);

  const above = await saveProject(baseProjectInput({ budget: 5000, developerId: spec.id, name: 'Дорожчий' }));
  assert.ok(above.ok);
  assert.equal(store.getSnapshot().projectsActive[1].myPercent, 25);

  // Явно заданий відсоток не перезаписується правилом.
  const manual = await saveProject(baseProjectInput({ budget: 5000, developerId: spec.id, name: 'Ручний', myPercent: 17 }));
  assert.ok(manual.ok);
  assert.equal(store.getSnapshot().projectsActive[2].myPercent, 17);

  // Без фахівця і без відсотка — 0 (автоматично нічого не підставляється).
  const without = await saveProject(baseProjectInput({ name: 'Без фахівця' }));
  assert.ok(without.ok);
  assert.equal(store.getSnapshot().projectsActive[3].myPercent, 0);

  // Некоректний відсоток відхиляється.
  const bad = await saveProject(baseProjectInput({ name: 'Поганий', myPercent: 101 }));
  assert.equal(bad.ok, false);
});

test('валютний бюджет проєкту: поріг застосовується до грн-еквівалента', async () => {
  clearAll();
  await bootStore();
  await saveRates({ usdRate: 41, eurRate: 44, usdtRate: 41 });
  const created = await saveSpecialist({ name: 'Олег', specialization: 'Frontend' });
  assert.ok(created.ok);
  const spec = store.getSnapshot().specialists[0];

  // 74 USD × 41 = 3 034 ₴ > 3 000 → 25%; 73 USD × 41 = 2 993 ₴ → 30%.
  const expensive = await saveProject(baseProjectInput({ budget: 74, currency: 'USD', developerId: spec.id, name: 'USD дорожче' }));
  assert.ok(expensive.ok);
  assert.equal(store.getSnapshot().projectsActive[0].myPercent, 25);

  const cheap = await saveProject(baseProjectInput({ budget: 73, currency: 'USD', developerId: spec.id, name: 'USD дешевше' }));
  assert.ok(cheap.ok);
  assert.equal(store.getSnapshot().projectsActive[1].myPercent, 30);
});

test('зміна налаштувань фахівця не перераховує збережені проєкти', async () => {
  clearAll();
  await bootStore();
  const created = await saveSpecialist({ name: 'Олег', specialization: 'Frontend' });
  assert.ok(created.ok);
  const spec = store.getSnapshot().specialists[0];
  await saveProject(baseProjectInput({ developerId: spec.id, budget: 5000 }));
  const before = JSON.stringify(store.getSnapshot().projectsActive);

  const changed = await saveSpecialist(
    { name: 'Олег', specialization: 'Frontend', myShareThreshold: 99999, mySharePercentUpTo: 10, mySharePercentAbove: 5 },
    spec.id,
  );
  assert.ok(changed.ok);
  assert.equal(JSON.stringify(store.getSnapshot().projectsActive), before);
  assert.equal(store.getSnapshot().projectsActive[0].myPercent, 25);
});

// ============================================================
// AI-помічник
// ============================================================

test('чернетка проєкту без myPercent не отримує дефолта; явний — лишається у полях', () => {
  const s = emptySnapshot();
  s.specialists.push({ id: 'sp1', name: 'Олег', specialization: 'Frontend' });
  const implicit = normalizePlan(
    { domain: 'projects', action: 'create', fields: { name: 'AI', type: 'IT', clientName: 'Кл', budget: 2999, developerId: 'sp1' } },
    s,
  );
  assert.equal(implicit.fields.myPercent, undefined);

  const explicit = normalizePlan(
    { domain: 'projects', action: 'create', fields: { name: 'AI', type: 'IT', clientName: 'Кл', budget: 2999, myPercent: 17 } },
    s,
  );
  assert.equal(explicit.fields.myPercent, 17);
});

test('підтвердження AI-чернетки без відсотка застосовує правило фахівця', async () => {
  clearAll();
  await bootStore();
  const created = await saveSpecialist({
    name: 'Іра',
    specialization: 'Design',
    myShareThreshold: 1000,
    mySharePercentUpTo: 40,
    mySharePercentAbove: 20,
  });
  assert.ok(created.ok);
  const spec = store.getSnapshot().specialists[0];

  const plan = {
    ...normalizePlan(
      { domain: 'projects', action: 'create', fields: { name: 'AI', type: 'IT', clientName: 'Кл', budget: 999, developerId: spec.id } },
      store.getSnapshot(),
    ),
    base: await fingerprint(store.getSnapshot()),
  };
  const result = await executePlan(plan);
  assert.equal(result.kind, 'applied');
  assert.equal(store.getSnapshot().projectsActive[0].myPercent, 40);
});

// ============================================================
// Резервні копії: старі сумісні, нові поля валідуються
// ============================================================

test('стара резервна копія без налаштувань імпортується, правило — початкове', async () => {
  const legacy = specialistPayload([
    { id: 'sp_old', name: 'Старий', specialization: 'Dev', telegram: '' },
  ]);
  const v = validateBackup(legacy);
  assert.equal(v.ok, true);
  assert.equal(v.counts.specialists, 1);
  assert.equal((v.content!.specialists[0] as unknown as Record<string, unknown>).myShareThreshold, undefined);
  assert.deepEqual(resolveMyShare(v.content!.specialists[0] as Specialist), DEFAULT_MY_SHARE);

  clearAll();
  await bootStore();
  const report = await applyImport(legacy);
  assert.equal(report.ok, true);
  const spec = store.getSnapshot().specialists[0];
  assert.equal(autoMyPercent(spec, 2999, 'UAH', settings), 30);
  assert.equal(autoMyPercent(spec, 5000, 'UAH', settings), 25);
});

test('налаштування у резервній копії: експорт/імпорт зберігає значення', async () => {
  const fresh = specialistPayload([
    { id: 'sp_new', name: 'Новий', specialization: 'Dev', myShareThreshold: 4000, mySharePercentUpTo: 35, mySharePercentAbove: 20 },
  ]);
  const v = validateBackup(fresh);
  assert.equal(v.ok, true);
  const rec = v.content!.specialists[0] as unknown as Record<string, unknown>;
  assert.equal(rec.myShareThreshold, 4000);
  assert.equal(rec.mySharePercentUpTo, 35);
  assert.equal(rec.mySharePercentAbove, 20);

  clearAll();
  await bootStore();
  const report = await applyImport(fresh);
  assert.equal(report.ok, true);
  const spec = store.getSnapshot().specialists[0];
  assert.equal(spec.myShareThreshold, 4000);
  assert.equal(autoMyPercent(spec, 3999, 'UAH', settings), 35);
  assert.equal(autoMyPercent(spec, 4001, 'UAH', settings), 20);
});

test('некоректні налаштування у копії: фахівця пропущено з явною помилкою', () => {
  const negative = specialistPayload([
    { id: 'sp_bad', name: 'Поганий', specialization: 'Dev', myShareThreshold: -5 },
  ]);
  const v1 = validateBackup(negative);
  assert.equal(v1.ok, true);
  assert.equal(v1.counts.specialists, 0);
  assert.equal(v1.skipped.specialists, 1);
  assert.ok(v1.recordIssues.some(e => e.message.includes('поріг')));

  const over = specialistPayload([
    { id: 'sp_over', name: 'Перевищення', specialization: 'Dev', mySharePercentAbove: 150 },
  ]);
  const v2 = validateBackup(over);
  assert.equal(v2.ok, true);
  assert.equal(v2.skipped.specialists, 1);

  const nan = specialistPayload([
    { id: 'sp_nan', name: 'NaN', specialization: 'Dev', myShareThreshold: 'abc' },
  ]);
  const v3 = validateBackup(nan);
  assert.equal(v3.ok, true);
  assert.equal(v3.skipped.specialists, 1);
});

