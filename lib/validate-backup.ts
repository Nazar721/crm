import type { Client, DataSnapshot, FinanceSettings, HostingPayment, HostingService, PlannedProject, Project, Task, TaskPriority, TaskStatus } from '@/types';
import { EXPORT_FORMAT_ID, EXPORT_SCHEMA_VERSION } from '@/types';
import type { CollectionKey } from '@/lib/datasource/types';
import { COLLECTION_KEYS } from '@/lib/datasource/types';
import { normalizeSettings } from '@/lib/settings';
import { kyivDateString } from '@/lib/dates';
import { toFiniteNumber } from '@/lib/validate';
import { HOSTING_CURRENCIES } from '@/lib/hosting';
import { isIsoInstant, isValidTaskDate, isValidTaskTime } from '@/lib/tasks';
import { kyivDateTimeToIso } from '@/lib/dates';

// ============================================================
// Runtime-валідація backup. Невідомий JSON відхиляється ДО будь-якого
// запису. Підтримка старих форматів визначена явно і перевіряється
// окремо від основного (поточного) формату.
// ============================================================

export type BackupFormat = 'v3' | 'v2' | 'v1' | 'legacy-flat' | 'unknown';

export type CollectionCounts = Record<CollectionKey, number>;

export interface BackupIssue {
  collection?: string;
  index?: number;
  id?: string;
  message: string;
}

export interface CollectionSample {
  collection: CollectionKey;
  index: number;
  id?: string;
  message: string;
}

export type BackupContent = Omit<DataSnapshot, 'financeSettings' | 'meta'>;

export interface ValidateBackupOptions {
  /**
   * Строгий режим (для фінальної міграції на етапі 2): жоден запис
   * не пропускається автоматично — будь-яка помилка запису блокує імпорт.
   */
  strict?: boolean;
}

export interface BackupValidation {
  ok: boolean;
  format: BackupFormat;
  version: number | null;
  exportedAt: string | null;
  /** Блокуючі помилки формату — імпорт неможливий. */
  errors: BackupIssue[];
  /** Помилки окремих записів — такі записи пропускаються. */
  recordIssues: BackupIssue[];
  counts: CollectionCounts;
  skipped: CollectionCounts;
  warnings: BackupIssue[];
  content: BackupContent | null;
  settings: FinanceSettings | null;
  /**
   * Пакет 04: колекції, відсутні у файлі (старі v1/v2/legacy). При імпорті
   * такі колекції НЕ перезаписуються — поточні дані зберігаються.
   */
  missing: CollectionKey[];
}

// Пакет 04: колекції хостингу відсутні у старих файлах (v1/v2/legacy) —
// це НЕ помилка валідації; їхня відсутність фіксується в `missing`, а при
// імпорті поточний хостинг за замовчуванням зберігається.
// Пакет 06: plannedProjects — та сама опційна політика.
const OPTIONAL_ARRAY_KEYS = new Set<CollectionKey>(['hostingServices', 'hostingPayments', 'tasks', 'plannedProjects']);
const REQUIRED_ARRAY_KEYS = COLLECTION_KEYS.filter(k => !OPTIONAL_ARRAY_KEYS.has(k));

function emptyCounts(): CollectionCounts {
  return {
    projectsActive: 0,
    projectsCompleted: 0,
    clients: 0,
    specialists: 0,
    partners: 0,
    transactions: 0,
    personalDebts: 0,
    savings: 0,
    hostingServices: 0,
    hostingPayments: 0,
    tasks: 0,
    plannedProjects: 0,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function validId(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 128;
}

/** Числове поле: рядок числа приводиться до числа з попередженням. */
function readNumber(
  rec: Record<string, unknown>,
  key: string,
  ctx: { collection: string; index: number; id: string },
  opts: { required?: boolean; min?: number; max?: number; label?: string } = {},
  acc: Acc,
): number {
  const raw = rec[key];
  if (raw === undefined || raw === null || raw === '') {
    if (opts.required) {
      acc.errors.push({ ...ctx, message: `${opts.label || key}: відсутнє числове значення` });
    }
    return 0;
  }
  const n = toFiniteNumber(raw);
  if (n === null) {
    acc.errors.push({ ...ctx, message: `${opts.label || key}: не є числом` });
    return 0;
  }
  if (typeof raw === 'string') {
    acc.warnings.push({ ...ctx, message: `${opts.label || key}: рядок «${raw}» перетворено на число` });
  }
  if (opts.min !== undefined && n < opts.min) {
    acc.errors.push({ ...ctx, message: `${opts.label || key}: значення ${n} менше допустимого (${opts.min})` });
    return 0;
  }
  if (opts.max !== undefined && n > opts.max) {
    acc.errors.push({ ...ctx, message: `${opts.label || key}: значення ${n} більше допустимого (${opts.max})` });
    return 0;
  }
  return n;
}

function readDate(
  rec: Record<string, unknown>,
  key: string,
  ctx: { collection: string; index: number; id: string },
  acc: Acc,
): string | undefined {
  const raw = rec[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const s = String(raw);
  const normalized = kyivDateString(s);
  if (!normalized) {
    acc.errors.push({ ...ctx, message: `${key}: некоректна дата «${s}»` });
    return undefined;
  }
  return s;
}

interface Ctx { collection: string; index: number; id: string }
interface Acc { errors: BackupIssue[]; warnings: BackupIssue[] }

function baseRecordChecks(rec: unknown, ctx: Ctx, acc: Acc): Record<string, unknown> | null {
  if (!isPlainObject(rec)) {
    acc.errors.push({ ...ctx, id: '', message: 'запис не є об’єктом' });
    return null;
  }
  const id = rec.id;
  if (!validId(id)) {
    acc.errors.push({ ...ctx, id: typeof id === 'string' ? id : '', message: 'відсутній або некоректний id' });
    return null;
  }
  ctx.id = id;
  return rec;
}

/**
 * Комісія партнеру: старі дані зберігали її СУМОЮ, нові — відсотком.
 * Нормалізація ідентична міграції v16 і виконується ДО остаточної
 * валідації, щоб legacy-записи не відкидалися до міграції.
 * Повертає `null`, якщо одиницю визначити неможливо.
 */
function normalizeCommissionPercent(value: number, budget: number): number | null {
  if (value <= 0) return 0;
  if (value <= 100) return value;
  if (budget > 0 && value <= budget) return Math.round(value / budget * 100);
  return null;
}

function validateProject(rec: unknown, ctx: Ctx, acc: Acc): Project | null {
  const r = baseRecordChecks(rec, ctx, acc);
  if (!r) return null;
  if (!str(r.name).trim()) {
    acc.errors.push({ ...ctx, message: 'відсутня назва проєкту' });
    return null;
  }
  const type = str(r.type).trim();
  if (!type) acc.warnings.push({ ...ctx, message: 'відсутній тип проєкту — встановлено «IT»' });
  const status = str(r.status).trim();
  if (!status) acc.warnings.push({ ...ctx, message: 'відсутній статус — встановлено «Очікування оплати»' });

  const budget = readNumber(r, 'budget', ctx, { required: true, min: 0, label: 'бюджет' }, acc);
  const prepayment = readNumber(r, 'prepayment', ctx, { min: 0, label: 'передоплата' }, acc);
  const paidToSpecialist = readNumber(r, 'paidToSpecialist', ctx, { min: 0, label: 'виплачено фахівцю' }, acc);
  const myPercent = readNumber(r, 'myPercent', ctx, { min: 0, max: 100, label: 'мій %' }, acc);
  const profitTaken = readNumber(r, 'profitTaken', ctx, { min: 0, label: 'забрав собі' }, acc);
  const fop = readNumber(r, 'fop', ctx, { min: 0, max: 100, label: 'ФОП %' }, acc);
  const partnerCommissionRaw = readNumber(r, 'partnerCommission', ctx, { min: 0, label: 'комісія партнеру' }, acc);
  const partnerCommission = normalizeCommissionPercent(partnerCommissionRaw, budget);
  if (partnerCommission === null) {
    acc.errors.push({
      ...ctx,
      message: `комісія партнеру «${partnerCommissionRaw}» при бюджеті ${budget}: не вдалося визначити одиницю (відсоток або сума)`,
    });
    return null;
  }

  const startDate = readDate(r, 'startDate', ctx, acc);
  const endDate = readDate(r, 'endDate', ctx, acc);
  const finishDate = readDate(r, 'finishDate', ctx, acc);
  const workStartDate = readDate(r, 'workStartDate', ctx, acc);
  const paymentDate = readDate(r, 'paymentDate', ctx, acc);

  return {
    ...r,
    id: ctx.id,
    name: str(r.name).trim(),
    type: type || 'IT',
    status: status || 'Очікування оплати',
    startDate: startDate || '',
    endDate,
    finishDate,
    workStartDate,
    paymentDate,
    clientId: str(r.clientId),
    clientName: str(r.clientName),
    budget,
    prepayment,
    paidToSpecialist,
    myPercent,
    profitTaken,
    fop,
    partnerCommission,
    paidToSpecialistRaw: undefined,
  } as Project;
}

function validateClient(rec: unknown, ctx: Ctx, acc: Acc): Client | null {
  const r = baseRecordChecks(rec, ctx, acc);
  if (!r) return null;
  if (!str(r.name).trim()) {
    acc.errors.push({ ...ctx, message: 'відсутнє ім’я клієнта' });
    return null;
  }
  const createdAt = readDate(r, 'createdAt', ctx, acc);
  return { ...r, id: ctx.id, name: str(r.name).trim(), createdAt } as Client;
}

function validateSimpleNamed(rec: unknown, ctx: Ctx, acc: Acc, label: string): Record<string, unknown> | null {
  const r = baseRecordChecks(rec, ctx, acc);
  if (!r) return null;
  if (!str(r.name).trim()) {
    acc.errors.push({ ...ctx, message: `відсутнє ім’я (${label})` });
    return null;
  }
  return { ...r, id: ctx.id, name: str(r.name).trim() };
}

/**
 * Числове налаштування «Моя частка». Відсутнє/порожнє поле видаляється —
 * старі резервні копії без цих полів сумісні і застосовують початкове правило.
 * Некоректне значення — помилка запису (фахівець пропускається з issue).
 */
function readOptionalSetting(
  rec: Record<string, unknown>,
  key: string,
  ctx: Ctx,
  label: string,
  opts: { max?: number; positive?: boolean },
  acc: Acc,
): number | undefined {
  const raw = rec[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const before = acc.errors.length;
  const n = readNumber(rec, key, ctx, { min: 0, max: opts.max, label }, acc);
  if (acc.errors.length > before) return undefined;
  if (opts.positive && n <= 0) {
    acc.errors.push({ ...ctx, message: `${label}: значення має бути більшим за 0` });
    return undefined;
  }
  return n;
}

function validateSpecialist(rec: unknown, ctx: Ctx, acc: Acc): Record<string, unknown> | null {
  const r = validateSimpleNamed(rec, ctx, acc, 'фахівець');
  if (!r) return null;
  const threshold = readOptionalSetting(r, 'myShareThreshold', ctx, 'поріг бюджету', { positive: true }, acc);
  const percentUpTo = readOptionalSetting(r, 'mySharePercentUpTo', ctx, 'відсоток до порогу', { max: 100 }, acc);
  const percentAbove = readOptionalSetting(r, 'mySharePercentAbove', ctx, 'відсоток понад поріг', { max: 100 }, acc);
  if (threshold !== undefined) r.myShareThreshold = threshold; else delete r.myShareThreshold;
  if (percentUpTo !== undefined) r.mySharePercentUpTo = percentUpTo; else delete r.mySharePercentUpTo;
  if (percentAbove !== undefined) r.mySharePercentAbove = percentAbove; else delete r.mySharePercentAbove;
  return r;
}

function validatePartner(rec: unknown, ctx: Ctx, acc: Acc): Record<string, unknown> | null {
  const r = validateSimpleNamed(rec, ctx, acc, 'партнер');
  if (!r) return null;
  const currency = str(r.currency) || 'UAH';
  if (!['UAH', 'USD', 'EUR', 'USDT'].includes(currency)) {
    acc.errors.push({ ...ctx, message: `недопустима валюта «${currency}»` });
    return null;
  }
  for (const key of ['paidToPartner', 'givenProjectsCount', 'givenProjectsPrice', 'ourCommission', 'paidToUs']) {
    r[key] = readNumber(r, key, ctx, { min: 0, label: key }, acc);
  }
  return r;
}

function validateTransaction(rec: unknown, ctx: Ctx, acc: Acc): Record<string, unknown> | null {
  const r = baseRecordChecks(rec, ctx, acc);
  if (!r) return null;
  const type = str(r.type);
  if (!['income', 'expense', 'transfer'].includes(type)) {
    acc.errors.push({ ...ctx, message: `недопустимий тип транзакції «${type}»` });
    return null;
  }
  if (!str(r.bank).trim()) {
    acc.errors.push({ ...ctx, message: 'відсутній рахунок (bank)' });
    return null;
  }
  if (type === 'transfer' && !str(r.toBank).trim()) {
    acc.errors.push({ ...ctx, message: 'для конвертації відсутній рахунок отримувача (toBank)' });
    return null;
  }
  const amount = readNumber(r, 'amount', ctx, { required: true, min: 0, label: 'сума' }, acc);
  const targetAmount = r.targetAmount === undefined || r.targetAmount === null || r.targetAmount === ''
    ? undefined
    : readNumber(r, 'targetAmount', ctx, { min: 0, label: 'сума отримувача' }, acc);

  const date = readDate(r, 'date', ctx, acc);
  const plannedDate = readDate(r, 'plannedDate', ctx, acc);
  const incomeStatus = r.incomeStatus === undefined ? undefined : str(r.incomeStatus);
  if (incomeStatus !== undefined && !['earned', 'incoming'].includes(incomeStatus)) {
    acc.errors.push({ ...ctx, message: `недопустимий статус доходу «${incomeStatus}»` });
    return null;
  }
  return { ...r, id: ctx.id, type, amount, targetAmount, date, plannedDate, incomeStatus } as Record<string, unknown>;
}

function validateDebt(rec: unknown, ctx: Ctx, acc: Acc): Record<string, unknown> | null {
  const r = baseRecordChecks(rec, ctx, acc);
  if (!r) return null;
  const type = str(r.type);
  if (!['owed_to_me', 'my_debt'].includes(type)) {
    acc.errors.push({ ...ctx, message: `недопустимий тип боргу «${type}»` });
    return null;
  }
  if (!str(r.person).trim()) {
    acc.errors.push({ ...ctx, message: 'відсутнє ім’я «хто / кому»' });
    return null;
  }
  const amount = readNumber(r, 'amount', ctx, { required: true, min: 0, label: 'сума' }, acc);
  const currency = str(r.currency) || 'UAH';
  if (!['UAH', 'USD', 'EUR'].includes(currency)) {
    acc.errors.push({ ...ctx, message: `недопустима валюта «${currency}»` });
    return null;
  }
  const date = readDate(r, 'date', ctx, acc);
  return { ...r, id: ctx.id, type, amount, currency, date } as Record<string, unknown>;
}

function validateSaving(rec: unknown, ctx: Ctx, acc: Acc): Record<string, unknown> | null {
  const r = baseRecordChecks(rec, ctx, acc);
  if (!r) return null;
  if (!str(r.bank).trim()) {
    acc.errors.push({ ...ctx, message: 'відсутній рахунок (bank)' });
    return null;
  }
  const amount = readNumber(r, 'amount', ctx, { min: 0, label: 'сума' }, acc);
  const goal = readNumber(r, 'goal', ctx, { required: true, min: 0, label: 'ціль' }, acc);
  const currency = str(r.currency) || 'UAH';
  if (!['UAH', 'USD', 'EUR'].includes(currency)) {
    acc.errors.push({ ...ctx, message: `недопустима валюта «${currency}»` });
    return null;
  }
  const date = readDate(r, 'date', ctx, acc);
  return { ...r, id: ctx.id, amount, goal, currency, date } as Record<string, unknown>;
}

type RecordValidator = (rec: unknown, ctx: Ctx, acc: Acc) => unknown;

function validateHostingServiceRecord(rec: unknown, ctx: Ctx, acc: Acc): HostingService | null {
  if (!isPlainObject(rec)) {
    acc.errors.push({ collection: ctx.collection, index: ctx.index, message: 'запис має бути об’єктом' });
    return null;
  }
  const name = str(rec.name).trim();
  if (!name) {
    acc.errors.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: 'відсутня назва послуги' });
    return null;
  }
  if (rec.currency !== undefined && rec.currency !== '' && !(HOSTING_CURRENCIES as readonly string[]).includes(str(rec.currency))) {
    acc.warnings.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: 'невідома валюта — використано UAH' });
  }
  if (rec.expectedPrice !== undefined && rec.expectedPrice !== null && toFiniteNumber(rec.expectedPrice) === null) {
    acc.warnings.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: 'некоректна очікувана ціна — поле очищено' });
  }
  const service: HostingService = {
    id: ctx.id,
    name: name.slice(0, 200),
    site: str(rec.site).slice(0, 300) || undefined,
    provider: str(rec.provider).slice(0, 200) || undefined,
    plan: str(rec.plan).slice(0, 200) || undefined,
    currency: (HOSTING_CURRENCIES as readonly string[]).includes(str(rec.currency)) ? str(rec.currency) : 'UAH',
    expectedPrice: toFiniteNumber(rec.expectedPrice) ?? undefined,
    note: str(rec.note).slice(0, 2000) || undefined,
    archived: rec.archived === true,
    createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : undefined,
  };
  ctx.id = service.id;
  return service;
}

function validateHostingPaymentRecord(rec: unknown, ctx: Ctx, acc: Acc): HostingPayment | null {
  if (!isPlainObject(rec)) {
    acc.errors.push({ collection: ctx.collection, index: ctx.index, message: 'запис має бути об’єктом' });
    return null;
  }
  const serviceId = str(rec.serviceId).trim();
  const date = str(rec.date).trim();
  const periodStart = str(rec.periodStart).trim();
  const periodEnd = str(rec.periodEnd).trim();
  const amount = toFiniteNumber(rec.amount);
  const bad: string[] = [];
  if (!validId(rec.serviceId)) bad.push('serviceId');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad.push('date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) bad.push('periodStart');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) bad.push('periodEnd');
  if (amount === null || amount <= 0) bad.push('amount');
  if (bad.length) {
    acc.errors.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: `некоректні поля: ${bad.join(', ')}` });
    return null;
  }
  const payment: HostingPayment = {
    id: ctx.id,
    serviceId,
    date,
    amount: amount ?? 0,
    currency: (HOSTING_CURRENCIES as readonly string[]).includes(str(rec.currency)) ? str(rec.currency) : 'UAH',
    periodStart,
    periodEnd,
    note: str(rec.note).slice(0, 2000) || undefined,
    createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : undefined,
  };
  if (periodStart > periodEnd) {
    acc.errors.push({ collection: ctx.collection, index: ctx.index, id: payment.id, message: 'кінець періоду раніший за початок' });
    return null;
  }
  ctx.id = payment.id;
  return payment;
}

function validateTaskRecord(rec: unknown, ctx: Ctx, acc: Acc): Task | null {
  if (!isPlainObject(rec)) {
    acc.errors.push({ collection: ctx.collection, index: ctx.index, message: 'запис має бути об’єктом' });
    return null;
  }
  const title = str(rec.title).trim();
  if (!title) {
    acc.errors.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: 'відсутня назва завдання' });
    return null;
  }
  const priority = (['low', 'normal', 'high'] as const).includes(str(rec.priority) as TaskPriority) ? str(rec.priority) as TaskPriority : 'normal';
  const status = (['planned', 'done', 'cancelled'] as const).includes(str(rec.status) as TaskStatus) ? str(rec.status) as TaskStatus : 'planned';
  const dueDate = str(rec.dueDate).trim();
  const dueTime = str(rec.dueTime).trim();
  // Строга календарна перевірка («30 лютого» та 25:99 відкидаються).
  if (dueDate && !isValidTaskDate(dueDate)) {
    acc.warnings.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: 'некоректний дедлайн (реальна дата) — поле очищено' });
  }
  if (dueTime && !isValidTaskTime(dueTime)) {
    acc.warnings.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: 'некоректний час дедлайну (00:00–23:59) — поле очищено' });
  } else if (dueDate && dueTime && isValidTaskDate(dueDate) && kyivDateTimeToIso(dueDate, dueTime) === null) {
    // Неможливий стінний час (Kyiv-перехід): для наявних даних політика —
    // день без часу (час не вигадується, з попередженням).
    acc.warnings.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: 'час дедлайну не існує в Kyiv (перехід) — поле очищено, дедлайн лишається днем' });
  }
  const task: Task = {
    id: ctx.id,
    title: title.slice(0, 300),
    description: str(rec.description).slice(0, 2000) || undefined,
    priority,
    status,
    dueDate: isValidTaskDate(dueDate) ? dueDate : undefined,
    dueTime: isValidTaskTime(dueTime) && !(dueDate && kyivDateTimeToIso(dueDate, dueTime) === null) ? dueTime : undefined,
    reminderAt: typeof rec.reminderAt === 'string' && isIsoInstant(rec.reminderAt) ? rec.reminderAt : undefined,
    reminderShownAt: typeof rec.reminderShownAt === 'string' && isIsoInstant(rec.reminderShownAt) ? rec.reminderShownAt : undefined,
    createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : undefined,
    updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : undefined,
    completedAt: typeof rec.completedAt === 'string' ? rec.completedAt : undefined,
  };
  ctx.id = task.id;
  return task;
}

function validatePlannedProjectRecord(rec: unknown, ctx: Ctx, acc: Acc): PlannedProject | null {
  if (!isPlainObject(rec)) {
    acc.errors.push({ collection: ctx.collection, index: ctx.index, message: 'запис має бути об’єктом' });
    return null;
  }
  const name = str(rec.name).trim();
  if (!name) {
    acc.errors.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: 'відсутня назва запланованого проєкту' });
    return null;
  }
  const category = str(rec.category).trim() || 'IT';
  if (!['IT', 'Design', 'Video'].includes(category)) {
    acc.warnings.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: `невідома категорія «${category}» — збережено як є` });
  }
  const clientName = str(rec.clientName).trim();
  if (!clientName) {
    acc.warnings.push({ collection: ctx.collection, index: ctx.index, id: ctx.id, message: 'відсутнє ім’я клієнта — поле залишено порожнім' });
  }
  const planned: PlannedProject = {
    id: ctx.id,
    name: name.slice(0, 300),
    category,
    clientName: clientName.slice(0, 200),
    clientId: validId(rec.clientId) ? str(rec.clientId).trim() : undefined,
    description: str(rec.description).slice(0, 2000) || undefined,
    createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : undefined,
    updatedAt: typeof rec.updatedAt === 'string' ? rec.updatedAt : undefined,
  };
  ctx.id = planned.id;
  return planned;
}

const VALIDATORS: Record<CollectionKey, RecordValidator> = {
  projectsActive: (rec, ctx, acc) => validateProject(rec, ctx, acc),
  projectsCompleted: (rec, ctx, acc) => validateProject(rec, ctx, acc),
  clients: (rec, ctx, acc) => validateClient(rec, ctx, acc),
  specialists: (rec, ctx, acc) => validateSpecialist(rec, ctx, acc),
  partners: (rec, ctx, acc) => validatePartner(rec, ctx, acc),
  transactions: (rec, ctx, acc) => validateTransaction(rec, ctx, acc),
  personalDebts: (rec, ctx, acc) => validateDebt(rec, ctx, acc),
  savings: (rec, ctx, acc) => validateSaving(rec, ctx, acc),
  hostingServices: (rec, ctx, acc) => validateHostingServiceRecord(rec, ctx, acc),
  hostingPayments: (rec, ctx, acc) => validateHostingPaymentRecord(rec, ctx, acc),
  tasks: (rec, ctx, acc) => validateTaskRecord(rec, ctx, acc),
  plannedProjects: (rec, ctx, acc) => validatePlannedProjectRecord(rec, ctx, acc),
};

function detectFormat(raw: Record<string, unknown>): { format: BackupFormat; version: number | null; data: Record<string, unknown> | null } {
  if (raw.app === EXPORT_FORMAT_ID) {
    const version = toFiniteNumber(raw.version);
    if (version === null) {
      return { format: 'unknown', version: null, data: null };
    }
    const data = isPlainObject(raw.data) ? raw.data : null;
    return { format: version >= 3 ? 'v3' : version === 2 ? 'v2' : version === 1 ? 'v1' : 'unknown', version, data };
  }
  // Старий (явно визначений) плоский формат: усі колекції на верхньому рівні.
  const hasAllCollections = REQUIRED_ARRAY_KEYS.every(k => Array.isArray(raw[k]));
  if (hasAllCollections) return { format: 'legacy-flat', version: 0, data: raw };
  return { format: 'unknown', version: null, data: null };
}

/**
 * Повна перевірка backup без жодного запису в сховище.
 */
export function validateBackup(raw: unknown, options: ValidateBackupOptions = {}): BackupValidation {
  const errors: BackupIssue[] = [];
  const recordIssues: BackupIssue[] = [];
  const warnings: BackupIssue[] = [];
  const counts = emptyCounts();
  const skipped = emptyCounts();

  const fail = (format: BackupFormat = 'unknown', version: number | null = null, exportedAt: string | null = null): BackupValidation => ({
    ok: false, format, version, exportedAt, errors, recordIssues, counts, skipped, warnings, content: null, settings: null, missing: [],
  });

  if (!isPlainObject(raw)) {
    errors.push({ message: 'Невідомий формат: очікувався JSON-об’єкт з даними CRM' });
    return fail();
  }

  const { format, version, data } = detectFormat(raw);
  if (format === 'unknown' || !data) {
    errors.push({
      message: 'Невідомий формат файлу: не впізнано ані поточний формат WebAgency CRM, ані визначений старий формат',
    });
    return fail();
  }
  if (version !== null && version > EXPORT_SCHEMA_VERSION) {
    errors.push({ message: `Файл має версію ${version}, а підтримується до ${EXPORT_SCHEMA_VERSION}. Оновіть CRM.` });
    return fail(format, version, null);
  }

  const exportedAtRaw = raw.exportedAt === undefined || raw.exportedAt === null ? null : String(raw.exportedAt);
  const exportedAt = exportedAtRaw && kyivDateString(exportedAtRaw) ? exportedAtRaw : null;
  if (exportedAtRaw && !exportedAt) warnings.push({ message: `exportedAt «${exportedAtRaw}» некоректний — ігнорується` });

  // Обов'язкові масиви.
  for (const key of REQUIRED_ARRAY_KEYS) {
    const value = data[key];
    if (value === undefined) {
      errors.push({ collection: key, message: `відсутня обов’язкова колекція «${key}»` });
      continue;
    }
    if (!Array.isArray(value)) {
      errors.push({ collection: key, message: `колекція «${key}» має бути масивом` });
    }
  }
  if (errors.length) return fail(format, version, exportedAt);

  // Налаштування фінансів: валідуються окремо, не блокують запис колекцій.
  let settings: FinanceSettings | null = null;
  if (raw.financeSettings !== undefined) {
    if (!isPlainObject(raw.financeSettings)) {
      errors.push({ message: 'financeSettings має бути об’єктом' });
      return fail(format, version, exportedAt);
    }
    const normalized = normalizeSettings(raw.financeSettings);
    const src = raw.financeSettings as Record<string, unknown>;
    if (toFiniteNumber(src.usdRate) === null || toFiniteNumber(src.eurRate) === null) {
      warnings.push({ message: 'Частина курсів у файлі некоректна — застосовано типові значення' });
    }
    settings = normalized;
  }

  const content = emptyCounts() as unknown as BackupContent;
  for (const key of COLLECTION_KEYS) content[key] = [];

  const missing: CollectionKey[] = [];
  for (const key of COLLECTION_KEYS) {
    const value = data[key];
    if (value === undefined) {
      // Обов'язкові вже перевірені вище; опціональні (хостинг) — фіксуємо.
      if (OPTIONAL_ARRAY_KEYS.has(key)) missing.push(key);
      continue;
    }
    if (!Array.isArray(value)) {
      if (OPTIONAL_ARRAY_KEYS.has(key)) errors.push({ collection: key, message: `колекція «${key}» має бути масивом` });
      continue;
    }
    const list = value as unknown[];
    const validator = VALIDATORS[key];
    list.forEach((item, index) => {
      const ctx: Ctx = { collection: key, index, id: '' };
      const acc: Acc = { errors: [], warnings: [] };
      const normalized = validator(item, ctx, acc);
      if (acc.errors.length || !normalized) {
        recordIssues.push(...acc.errors);
        if (!acc.errors.length) recordIssues.push({ collection: key, index, id: ctx.id, message: 'невалідний запис' });
        skipped[key] += 1;
        return;
      }
      warnings.push(...acc.warnings);
      (content[key] as unknown[]).push(normalized);
      counts[key] += 1;
    });
  }

  // Базові зв'язки: проєкт → клієнт.
  const clientIds = new Set(content.clients.map(c => c.id));
  const projects = [...content.projectsActive, ...content.projectsCompleted];
  projects.forEach(p => {
    if (p.clientId && !clientIds.has(p.clientId)) {
      warnings.push({
        collection: p.clientId && content.projectsActive.includes(p) ? 'projectsActive' : 'projectsCompleted',
        id: p.id,
        message: `проєкт «${p.name}» посилається на невідомого клієнта ${p.clientId} — зв’язок очищено, клієнт буде відновлено з назви`,
      });
      p.clientId = '';
    }
    if (p.developerId && !content.specialists.some(s => s.id === p.developerId)) {
      warnings.push({ id: p.id, message: `проєкт «${p.name}» посилається на невідомого фахівця ${p.developerId}` });
    }
    if (p.partnerId && !content.partners.some(s => s.id === p.partnerId)) {
      warnings.push({ id: p.id, message: `проєкт «${p.name}» посилається на невідомого партнера ${p.partnerId}` });
    }
  });
  content.transactions.forEach(t => {
    const projectId = typeof t.projectId === 'string' ? t.projectId : '';
    if (projectId && !projects.some(p => p.id === projectId)) {
      warnings.push({ id: t.id, message: `транзакція посилається на невідомий проєкт ${projectId}` });
    }
  });

  // Пакет 04: оплати хостингу посилаються лише на наявні картки хостингу.
  const hostingServiceIds = new Set(content.hostingServices.map(h => h.id));
  content.hostingPayments.forEach(p => {
    if (!hostingServiceIds.has(p.serviceId)) {
      errors.push({
        collection: 'hostingPayments',
        id: p.id,
        message: `оплата хостингу «${p.id}» посилається на невідому картку ${p.serviceId}`,
      });
    }
  });

  // Унікальність ID: порушення ламає адресацію редагування, Map-індекси,
  // React-ключі та первинні ключі БД на етапі 2. Відхиляється весь імпорт.
  const seenIds = new Map<CollectionKey, Map<string, number>>();
  for (const key of COLLECTION_KEYS) {
    const seen = seenIds.get(key) ?? new Map<string, number>();
    content[key].forEach((record, index) => {
      const id = String((record as { id?: unknown }).id ?? '');
      const first = seen.get(id);
      if (first !== undefined) {
        errors.push({
          collection: key,
          index,
          id,
          message: `дублікат id «${id}» у колекції «${key}» (перший запис — індекс ${first})`,
        });
      } else {
        seen.set(id, index);
      }
    });
    seenIds.set(key, seen);
  }

  // Проєкти адресуються через один id у двох списках — перевіряємо разом.
  const projectIds = new Map<string, string>();
  (['projectsActive', 'projectsCompleted'] as const).forEach(key => {
    content[key].forEach((project, index) => {
      const id = String(project.id);
      const where = projectIds.get(id);
      if (where) {
        errors.push({
          collection: key,
          index,
          id,
          message: `дублікат id «${id}» у проєктах: уже є у «${where}» (активні та завершені — одна адресація)`,
        });
      } else {
        projectIds.set(id, key);
      }
    });
  });

  for (const key of missing) {
    warnings.push({
      collection: key,
      message: `копія не містить колекцію «${key}» (старий формат) — при імпорті поточні дані цієї колекції зберігаються`,
    });
  }

  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0);
  const totalSkipped = Object.values(skipped).reduce((a, b) => a + b, 0);
  if (totalSkipped > 0) {
    warnings.push({ message: `Пропущено некоректних записів: ${totalSkipped}` });
  }
  if (totalRecords === 0 && totalSkipped === 0) {
    warnings.push({ message: 'Файл не містить жодного запису' });
  }
  if (format === 'legacy-flat') {
    warnings.push({ message: 'Старий формат без метаданих (legacy-flat): версія та час експорту відсутні' });
  }

  if (errors.length) {
    return { ok: false, format, version, exportedAt, errors, recordIssues, counts, skipped, warnings, content: null, settings, missing };
  }

  if (options.strict && recordIssues.length > 0) {
    errors.push({
      message: `Строгий режим: ${recordIssues.length} записів містять помилки — імпорт відхилено, дані не замінено`,
    });
    return { ok: false, format, version, exportedAt, errors, recordIssues, counts, skipped, warnings, content: null, settings, missing };
  }

  return {
    ok: true,
    format,
    version,
    exportedAt,
    errors,
    recordIssues,
    counts,
    skipped,
    warnings,
    content,
    settings,
    missing,
  };
}
