import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLightScope } from '@/lib/assistant/scope';
import { modelContext, modelContextLite, compactRecord } from '@/lib/assistant/plan';
import { askProvider, resolveProvider, OPENROUTER_MODEL } from '@/lib/assistant/provider';
import { emptySnapshot, makeProject, makeClient, makeTransaction } from './helpers';
import type { DataSnapshot, Transaction, Project } from '@/types';

test('звичайна розмова отримує легкий контекст, запити по CRM — повний', () => {
  // Привітання й прості репліки без цифр і слів про дані CRM.
  for (const t of ['Привіт', 'привіт 👋', 'Привіт, як справи?', 'Все гарно, дякую', 'скажи що-небудь смішне', 'Порадь, як краще організувати робочий день']) {
    assert.equal(isLightScope(t), true, t);
  }
  // Будь-який намір по CRM, цифри, дії або продовження чернетки — повний.
  for (const t of ['скільки в мене грошей?', 'Які борги?', 'доплатив 500 за проєкт', 'запиши запланований сайт для Марії', 'привіт, покажи баланс', 'квітень звіт', '500', 'конвертуй 100 у долари', 'хостинг продовження']) {
    assert.equal(isLightScope(t), false, t);
  }
});

test('коротке продовження після CRM-репліки лишається на повному контексті', () => {
  const crmTurn = [
    { role: 'user', text: 'який бюджет у проєкту Сайт для Rote core?' },
    { role: 'assistant', text: 'Бюджет — 45 000 грн.' },
  ];
  // «а по ньому?» без історії — легке; після CRM-реплік — повний контекст,
  // бо стосується проєкту з попереднього повідомлення.
  assert.equal(isLightScope('а по ньому?'), true);
  assert.equal(isLightScope('а по ньому?', crmTurn), false);
  assert.equal(isLightScope('і далі?', [{ role: 'user', text: 'який бюджет у проєкту X?' }]), false);
  assert.equal(isLightScope('а по ньому?', [{ role: 'user', text: 'привіт' }, { role: 'assistant', text: 'Привіт! Чим допомогти?' }]), true, 'після чистої розмови — знову легкий');
});

test('легкий контекст малий і не містить списків записів CRM', () => {
  const s = emptySnapshot();
  s.projectsActive = [makeProject()];
  s.transactions = [makeTransaction()];
  s.clients = [makeClient()];
  const lite = modelContextLite(s) as unknown as Record<string, unknown>;
  assert.equal(lite.scope, 'chat');
  assert.ok(!('clients' in lite) && !('projects' in lite) && !('transactions' in lite) && !('hosting' in lite));
  assert.ok(JSON.stringify(lite).length < 8000);
  // Повний контекст для тих самих даних містить усі записи.
  const full = modelContext(s) as unknown as Record<string, unknown>;
  assert.equal((full.projects as unknown[]).length, 1);
  assert.equal((full.transactions as unknown[]).length, 1);
});

test('ущільнення контексту безвтратне: усі записи присутні, пусті поля прибрані', () => {
  const s: DataSnapshot = emptySnapshot();
  const seen: string[] = [];
  for (let i = 0; i < 200; i++) {
    const t = makeTransaction({ description: i % 2 ? '' : `Оплата ${i}`, category: i % 3 ? '' : 'Проєкт' }) as Transaction;
    s.transactions.push(t); seen.push(t.id);
  }
  const executorsProject: Project = { ...makeProject({ name: 'Явні виконавці' }), executors: [{ specialistId: 'spec_1', percent: 60, paid: 100 }] };
  s.projectsActive = [executorsProject, makeProject({ name: 'Старий запис' })];
  const ctx = modelContext(s) as unknown as { transactions: { id: string; description?: string; incomeStatus?: string; hidden?: boolean }[]; projects: { name: string; shares?: unknown; selfShare?: unknown }[] };
  assert.deepEqual(ctx.transactions.map(t => t.id).sort(), [...seen].sort(), 'жодна транзакція не пропущена');
  assert.equal(ctx.transactions.filter(t => t.incomeStatus).length, 0, 'типовий earned не дублюється');
  const explicit = ctx.projects.find(p => p.name === 'Явні виконавці')!;
  assert.ok(Array.isArray(explicit.shares), 'явні виконавці лишаються в контексті');
  const legacy = ctx.projects.find(p => p.name === 'Старий запис')!;
  assert.ok(!('shares' in legacy) && !('selfShare' in legacy), 'похідні частки старого запису не дублюються');
});

test('compactRecord не чіпає нулі, суми 0 і видимі прапорці', () => {
  assert.deepEqual(compactRecord({ amount: 0, bank: 'mono', hidden: true, incomeStatus: 'incoming', rate: 0, description: '' }), { amount: 0, bank: 'mono', hidden: true, incomeStatus: 'incoming' });
});

test('перевищення контексту моделі показує фактичну причину, а не загальний збій', async () => {
  const fail = (async () => new Response(JSON.stringify({ error: { message: 'This model supports maximum context length of 8192 tokens' } }), { status: 400 })) as typeof fetch;
  await assert.rejects(
    askProvider([], { ...resolveProvider('openrouter', OPENROUTER_MODEL), key: 'synthetic' }, undefined, fail),
    (e: { code: string; message: string }) => e.code === 'model_incompatible' && /вікно контексту/i.test(e.message),
  );
});
