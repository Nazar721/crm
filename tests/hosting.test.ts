import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addCalendarDays, addCalendarMonths, coverageOn, filterHostingServices,
  hostingCoverage, hostingSummary, hostingTotalsByCurrency, lastPaymentOf,
  paymentsOfService, proposeExtension,
} from '@/lib/hosting';
import {
  applyAssistantPlan, archiveHostingService, deleteHostingPayment, saveHostingPayment, saveHostingService,
} from '@/lib/actions';
import { fingerprint, missingQuestions, modelContext, normalizePlan } from '@/lib/assistant/plan';
import { buildExportPayload } from '@/lib/export';
import { applyImport } from '@/lib/importer';
import { validateBackup } from '@/lib/validate-backup';
import * as store from '@/lib/store';
import { clearAll, bootStore, emptySnapshot } from './helpers';
import { today } from '@/lib/utils';
import type { HostingPayment, HostingService } from '@/types';

// ============================================================
// Пакет 04: хостинг — спільні розрахунки, дії, імпорт v3, AI.
// Синтетичні дані; жодних автоматичних транзакцій «Фінансів».
// ============================================================

const DAY = '2026-10-13'; // фіксований «сьогодні» для розрахунків

function service(overrides: Partial<HostingService> = {}): HostingService {
  return {
    id: 'hs1', name: 'Квіти', site: 'kvity.ua', provider: 'Хостер',
    currency: 'UAH', archived: false, ...overrides,
  };
}

function payment(overrides: Partial<HostingPayment> = {}): HostingPayment {
  return {
    id: 'hp1', serviceId: 'hs1', date: '2026-01-12', amount: 1200, currency: 'UAH',
    periodStart: '2026-10-12', periodEnd: '2027-10-11', ...overrides,
  };
}

// ------------------------------------------------------------
// Календарна арифметика (високосний, кінець місяця)
// ------------------------------------------------------------

test('календар: місяці з пригортанням і високосний рік', () => {
  assert.equal(addCalendarMonths('2026-01-31', 1), '2026-02-28', '31.01 → 28.02 (невисокосний)');
  assert.equal(addCalendarMonths('2024-01-31', 1), '2024-02-29', '31.01 → 29.02 (високосний)');
  assert.equal(addCalendarMonths('2024-02-29', 12), '2025-02-28', '29.02.2024 + рік → 28.02.2025');
  assert.equal(addCalendarMonths('2026-11-15', 2), '2027-01-15', 'без пригортання');
  assert.equal(addCalendarDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addCalendarDays('2024-02-28', 1), '2024-02-29', 'високосний день');
});

test('календар: пропозиція продовження від кінця поточного покриття', () => {
  const s = service();
  const payments = [payment({ periodStart: '2026-10-12', periodEnd: '2027-10-11' })];
  const proposed = proposeExtension(s, payments, 12, DAY)!;
  assert.deepEqual(proposed, { start: '2027-10-12', end: '2028-10-11' }, 'наступний день після покриття + рік');
  // Прострочення: початок не визначений — власник уточнює.
  const overdue = [payment({ periodStart: '2025-01-01', periodEnd: '2025-12-31' })];
  assert.equal(proposeExtension(s, overdue, 12, DAY), null);
});

// ------------------------------------------------------------
// Стани покриття, попередження, прогалини
// ------------------------------------------------------------

test('покриття: стани за фактичними періодами на фіксований день', () => {
  const s = service();
  // Без оплат
  assert.equal(hostingCoverage(s, [], DAY).status, 'no_payment');
  // Оплачено (запас > 30 днів)
  const paid = hostingCoverage(s, [payment({ periodStart: '2026-09-01', periodEnd: '2026-12-31' })], DAY);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.coverageEnd, '2026-12-31');
  assert.ok((paid.daysLeft ?? -1) > 30);
  // Закінчується: сьогодні останній день (день кінця включно)
  const todayEnd = hostingCoverage(s, [payment({ periodStart: '2025-10-14', periodEnd: DAY })], DAY);
  assert.equal(todayEnd.status, 'ending');
  assert.equal(todayEnd.daysLeft, 0);
  assert.ok(todayEnd.warnings.some(w => w.includes('сьогодні')));
  // 3 дні / 30 днів
  assert.equal(hostingCoverage(s, [payment({ periodEnd: '2026-10-16' })], DAY).status, 'ending');
  assert.ok(hostingCoverage(s, [payment({ periodEnd: '2026-10-16' })], DAY).warnings.some(w => w.includes('3 дн')));
  assert.equal(hostingCoverage(s, [payment({ periodEnd: '2026-11-12' })], DAY).status, 'ending', '30 днів — ще закінчується');
  assert.equal(hostingCoverage(s, [payment({ periodEnd: '2026-11-13' })], DAY).status, 'paid', '31 день — оплачено');
  // Прострочено: покриття завершилося вчора
  const overdue = hostingCoverage(s, [payment({ periodStart: '2025-10-12', periodEnd: '2026-10-12' })], DAY);
  assert.equal(overdue.status, 'overdue');
  assert.equal(overdue.coverageEnd, null);
  // Прогалина: майбутній період НЕ робить оплаченим сьогодні
  const gap = hostingCoverage(s, [
    payment({ id: 'a', periodStart: '2025-10-12', periodEnd: '2026-10-12' }),
    payment({ id: 'b', date: '2026-10-10', periodStart: '2026-11-01', periodEnd: '2027-10-31' }),
  ], DAY);
  assert.equal(gap.status, 'overdue', 'майбутній період не є оплатою на сьогодні');
  assert.equal(gap.hasGap, true);
  assert.equal(gap.nextPeriod!.start, '2026-11-01');
  // Лікар: початок періоду = сьогодні → покрито
  assert.equal(hostingCoverage(s, [payment({ periodStart: DAY, periodEnd: '2027-01-01' })], DAY).status, 'paid');
  // Архів переважає
  assert.equal(hostingCoverage(service({ archived: true }), [payment({ periodEnd: '2026-10-14' })], DAY).status, 'archived');
  assert.equal(hostingCoverage(service({ archived: true }), [], DAY).warnings.length, 0);
});

test('покриття: остання оплата за датою, не за порядком; totals за валютами', () => {
  const payments = [
    payment({ id: 'p3', date: '2026-03-01', amount: 300 }),
    payment({ id: 'p1', date: '2026-01-12', amount: 1200 }),
    payment({ id: 'p2', date: '2026-02-01', amount: 700, currency: 'USD' }),
  ];
  assert.equal(lastPaymentOf(payments)!.id, 'p3', 'максимум за датою, не перший/останній у масиві');
  assert.deepEqual(paymentsOfService('hs1', payments).map(p => p.id), ['p1', 'p2', 'p3'], 'історія за датою');
  const totals = hostingTotalsByCurrency(payments);
  assert.deepEqual(totals, [
    { currency: 'UAH', total: 1500, count: 2 },
    { currency: 'USD', total: 700, count: 1 },
  ], 'валюти не змішуються');
  const september = hostingTotalsByCurrency(payments, { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(september, [{ currency: 'USD', total: 700, count: 1 }]);
});

test('підсумки та фільтри сторінки', () => {
  const services = [
    service({ id: 'a', name: 'Активний', site: 'a.ua' }),
    service({ id: 'b', name: 'Без оплати', site: 'b.ua' }),
    service({ id: 'c', name: 'Прострочений', site: 'c.ua', provider: 'Інший' }),
    service({ id: 'd', name: 'Архівний', site: 'd.ua', archived: true }),
  ];
  const payments = [
    payment({ id: 'pa', serviceId: 'a', periodStart: '2026-09-01', periodEnd: '2026-12-31' }),
    payment({ id: 'pc', serviceId: 'c', periodStart: '2025-01-01', periodEnd: '2026-01-01' }),
  ];
  const summary = hostingSummary(services, payments, DAY);
  assert.equal(summary.active, 3);
  assert.equal(summary.noPayment, 1);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.archived, 1);
  const found = filterHostingServices(services, payments, { query: 'a.ua' });
  assert.equal(found.length, 1, 'пошук за доменом');
  assert.equal(found[0].service.id, 'a');
  assert.equal(filterHostingServices(services, payments, { status: 'overdue' })[0].service.id, 'c');
  assert.equal(filterHostingServices(services, payments, { provider: 'Інший' })[0].service.id, 'c');
});

// ------------------------------------------------------------
// Дії: CRUD, архів, оплати; без транзакцій «Фінансів»
// ------------------------------------------------------------

test('дії: створення/редагування картки без транзакцій і карток проєктів', async () => {
  clearAll();
  await bootStore();
  const created = await saveHostingService({ name: 'Квіти', site: 'kvity.ua', provider: 'Хостер', currency: 'UAH', expectedPrice: 1200 });
  assert.equal(created.ok, true);
  assert.equal(store.getSnapshot().hostingServices.length, 1);
  assert.equal(store.getSnapshot().transactions.length, 0, 'жодних автоматичних фінансових транзакцій');
  assert.equal(store.getSnapshot().projectsActive.length, 0, 'без карток «Проєктів»');
  const id = store.getSnapshot().hostingServices[0].id;
  const edited = await saveHostingService({ name: 'Квіти (оновлено)', site: 'kvity.ua' }, id);
  assert.equal(edited.ok, true);
  assert.equal(store.getSnapshot().hostingServices[0].name, 'Квіти (оновлено)');
  const missing = await saveHostingService({ name: 'X' }, 'ghost');
  assert.equal(missing.ok, false);
  const invalid = await saveHostingService({ name: '' });
  assert.equal(invalid.ok, false, 'назва обов’язкова');
});

test('дії: оплата/продовження — історія не перезаписується; невідомий serviceId → відмова', async () => {
  clearAll();
  await bootStore();
  const serviceResult = await saveHostingService({ name: 'Квіти', currency: 'UAH' });
  assert.ok(serviceResult.ok);
  const serviceId = store.getSnapshot().hostingServices[0].id;

  const ghost = await saveHostingPayment({ serviceId: 'ghost', date: DAY, amount: 100, periodStart: DAY, periodEnd: '2026-11-12' });
  assert.equal(ghost.ok, false, 'оплата прив’язується лише до наявної картки');

  const first = await saveHostingPayment({ serviceId, date: '2026-01-12', amount: 1200, periodStart: '2026-10-12', periodEnd: '2027-10-11' });
  assert.ok(first.ok);
  // Продовження — новий запис, історія не перезаписується.
  const second = await saveHostingPayment({ serviceId, date: '2026-10-10', amount: 1200, periodStart: '2027-10-12', periodEnd: '2028-10-11' });
  assert.ok(second.ok);
  assert.equal(store.getSnapshot().hostingPayments.length, 2, 'обидві оплати в історії');
  assert.equal(store.getSnapshot().transactions.length, 0);

  // Видалення окремої помилкової оплати.
  const firstId = (first as { value?: HostingPayment }).value?.id ?? store.getSnapshot().hostingPayments[0].id;
  const removed = await deleteHostingPayment(firstId);
  assert.equal(removed.ok, true);
  assert.equal(store.getSnapshot().hostingPayments.length, 1);
  assert.equal((await deleteHostingPayment('ghost')).ok, false);
});

test('дії: архів не видаляє оплати; повернення з архіву', async () => {
  clearAll();
  await bootStore();
  await saveHostingService({ name: 'Квіти' });
  const serviceId = store.getSnapshot().hostingServices[0].id;
  await saveHostingPayment({ serviceId, date: DAY, amount: 500, periodStart: DAY, periodEnd: '2026-11-12' });
  const archived = await archiveHostingService(serviceId, true);
  assert.equal(archived.ok, true);
  assert.equal(store.getSnapshot().hostingServices[0].archived, true);
  assert.equal(store.getSnapshot().hostingPayments.length, 1, 'архів не видаляє оплати');
  const back = await archiveHostingService(serviceId, false);
  assert.equal(back.ok, true);
  assert.equal(store.getSnapshot().hostingServices[0].archived, false);
  assert.equal((await archiveHostingService('ghost', true)).ok, false);
});

test('журнал: картка й оплата — групи історії; безпечне скасування оплати', async () => {
  clearAll();
  await bootStore();
  await saveHostingService({ name: 'Квіти' });
  const serviceId = store.getSnapshot().hostingServices[0].id;
  await saveHostingPayment({ serviceId, date: DAY, amount: 900, periodStart: DAY, periodEnd: '2026-11-12' });
  const events = (await store.listHistory({ limit: 50 })).events;
  const serviceEvent = events.find(e => e.section === 'hosting' && e.action === 'create' && e.changes.some(c => c.collection === 'hostingServices'));
  const paymentEvent = events.find(e => e.changes.some(c => c.collection === 'hostingPayments' && c.change === 'create'));
  assert.ok(serviceEvent, 'подія картки');
  assert.ok(paymentEvent, 'подія оплати (одна група)');
  // Скасування картки ЗА НАЯВНОЇ оплати — конфлікт залежності (без запису).
  const blocked = await store.undoHistory({ eventId: serviceEvent!.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(blocked.ok, false, 'оплата посилається на картку — перевірка залежностей');
  assert.equal(store.getSnapshot().hostingServices.length, 1, 'карту не прибрано');
  // Скасування оплати — безпечно; після цього картку вже можна (історія порожня).
  const undonePayment = await store.undoHistory({ eventId: paymentEvent!.id, requestId: crypto.randomUUID(), source: 'Форма' });
  assert.equal(undonePayment.ok, true);
  assert.equal(store.getSnapshot().hostingPayments.length, 0);
});

// ------------------------------------------------------------
// Експорт v3 / імпорт: старі копії не стирають хостинг
// ------------------------------------------------------------

test('експорт v3 містить хостинг; версія формату 3', () => {
  const payload = buildExportPayload(emptySnapshot());
  assert.equal(payload.version, 3);
  assert.deepEqual(payload.data.hostingServices, []);
  assert.deepEqual(payload.data.hostingPayments, []);
});

test('імпорт старої копії (v2) не стирає наявний хостинг', async () => {
  clearAll();
  await bootStore();
  await saveHostingService({ name: 'Наявний хостинг' });
  const serviceId = store.getSnapshot().hostingServices[0].id;
  await saveHostingPayment({ serviceId, date: DAY, amount: 100, periodStart: DAY, periodEnd: '2026-11-12' });
  // Стара копія v2 — без hosting-ключів.
  const legacy = buildExportPayload(emptySnapshot());
  const legacyRaw = JSON.parse(JSON.stringify(legacy));
  legacyRaw.version = 2;
  delete legacyRaw.data.hostingServices;
  delete legacyRaw.data.hostingPayments;
  const validation = validateBackup(legacyRaw);
  assert.equal(validation.ok, true, 'стара копія валідна');
  assert.deepEqual([...validation.missing].sort(), ['hostingPayments', 'hostingServices']);
  assert.ok(validation.warnings.some(w => w.message.includes('зберігаються')));
  const report = await applyImport(legacyRaw);
  assert.equal(report.ok, true);
  assert.equal(store.getSnapshot().hostingServices.length, 1, 'хостинг збережено');
  assert.equal(store.getSnapshot().hostingPayments.length, 1, 'оплати збережено');
  assert.deepEqual([...(report.kept ?? [])].sort(), ['hostingPayments', 'hostingServices']);
});

test('імпорт v3 з явними порожніми масивами перезаписує хостинг (визначений сенс)', async () => {
  clearAll();
  await bootStore();
  await saveHostingService({ name: 'Буде видалено імпортом' });
  const raw = buildExportPayload(emptySnapshot()); // v3, порожні масиви
  const report = await applyImport(raw);
  assert.equal(report.ok, true);
  assert.equal(store.getSnapshot().hostingServices.length, 0, 'явний порожній масив = перезапис');
  assert.equal((report.kept ?? []).length, 0);
});

test('імпорт: оплата на невідому картку → відмова без запису', () => {
  const raw = buildExportPayload(emptySnapshot());
  raw.data.hostingServices = [];
  raw.data.hostingPayments = [payment({ serviceId: 'ghost' })];
  const validation = validateBackup(raw);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some(e => (e.message || '').includes('невідому картку')));
});

test('перезапуск: хостинг переживає перечитування сховища', async () => {
  clearAll();
  await bootStore();
  await saveHostingService({ name: 'Після перезапуску' });
  await store.reloadStore();
  assert.equal(store.getSnapshot().hostingServices.length, 1);
  assert.equal(store.getSnapshot().hostingServices[0].name, 'Після перезапуску');
});

// ------------------------------------------------------------
// AI: домени hosting / hostingPayments
// ------------------------------------------------------------

test('AI: схеми, обов’язкові поля, дефолти, відмова видалення картки', () => {
  const s = { ...emptySnapshot(), hostingServices: [service()] };
  // Створення картки без назви → уточнення
  const planNoName = normalizePlan({ domain: 'hosting', action: 'create', fields: { provider: 'Хостер' } }, s);
  assert.deepEqual(missingQuestions(planNoName, s).map(q => q.key), ['name']);
  // Створення оплати: обов'язкові поля + дефолти
  const planPay = normalizePlan(
    { domain: 'hostingPayments', action: 'create', fields: { serviceId: 'hs1', amount: 1200, periodStart: '2026-10-12', periodEnd: '2027-10-11' } },
    s,
  );
  assert.equal(planPay.fields.date, today(), 'дата оплати за замовчуванням — сьогодні');
  assert.equal(planPay.fields.currency, 'UAH');
  assert.deepEqual(missingQuestions(planPay, s).map(q => q.key), []);
  // Невідомий serviceId → відмова
  assert.throws(
    () => normalizePlan(
      { domain: 'hostingPayments', action: 'create', fields: { serviceId: 'ghost', amount: 1, periodStart: DAY, periodEnd: DAY } },
      s,
    ),
    /Не знайдено serviceId|Не знайдено/,
  );
  // Видалення картки → відмова (архів)
  assert.throws(
    () => normalizePlan({ domain: 'hosting', action: 'delete', recordId: 'hs1', fields: {} }, { ...s, hostingServices: [service()] }),
    /архів/,
  );
});

test('AI: виконання та контекст; повторне підтвердження без дублікатів', async () => {
  clearAll();
  await bootStore();
  // Створення картки через помічника
  const created = await applyAssistantPlan({
    domain: 'hosting', action: 'create',
    fields: { name: 'Квіти', provider: 'Хостер', currency: 'UAH', archived: false },
    base: await fingerprint(store.getSnapshot()),
  } as never);
  assert.equal(created.ok, true);
  assert.equal(store.getSnapshot().hostingServices.length, 1);
  assert.equal(store.getSnapshot().transactions.length, 0);
  const serviceId = store.getSnapshot().hostingServices[0].id;
  // Оплата через помічника
  const paid = await applyAssistantPlan({
    domain: 'hostingPayments', action: 'create',
    fields: { serviceId, amount: 1200, date: '2026-10-12', currency: 'UAH', periodStart: '2026-10-12', periodEnd: '2027-10-11' },
    base: await fingerprint(store.getSnapshot()),
  } as never);
  assert.equal(paid.ok, true);
  assert.equal(store.getSnapshot().hostingPayments.length, 1);
  // Повторне підтвердження тієї ж чернетки → конфлікт бази, без дубліката
  const repeat = await applyAssistantPlan({
    domain: 'hostingPayments', action: 'create',
    fields: { serviceId, amount: 1200, date: '2026-10-12', currency: 'UAH', periodStart: '2026-10-12', periodEnd: '2027-10-11' },
    base: 'stale-base',
  } as never);
  assert.equal(repeat.ok, false);
  assert.equal(store.getSnapshot().hostingPayments.length, 1, 'дубліката немає');
  // Контекст містить готові підсумки хостингу
  const context = modelContext(store.getSnapshot()) as unknown as { hosting: { services: { id: string; status: string }[]; payments: { id: string }[]; totals: unknown[] } };
  assert.equal(context.hosting.services.length, 1);
  assert.ok(context.hosting.services[0].status, 'стан покриття в контексті');
  assert.equal(context.hosting.payments.length, 1);
});
