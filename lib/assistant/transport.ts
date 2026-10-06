import {createRemoteTransport} from './remote';
import type {
  AssistantConfirmRequest,
  AssistantConfirmResult,
  AssistantDraft,
  AssistantReply,
  AssistantSendRequest,
  AssistantClarifyRequest,
  AssistantTransport,
  AssistantDomain,
  AssistantActionType,
  ProviderSettings,
} from './contract';
import { ASSISTANT_ERROR_MESSAGES, DOMAIN_LABELS, ACTION_LABELS } from './contract';

function cancelledError() {
  return { kind: 'error' as const, error: { code: 'cancelled' as const, message: ASSISTANT_ERROR_MESSAGES.cancelled.message, hint: ASSISTANT_ERROR_MESSAGES.cancelled.hint } };
}

/**
 * Типова реалізація: серверна частина ще не підключена.
 * Виробничий UI показує «Помічник ще не підключений» і не стверджує,
 * що щось було створено.
 */
export function createNotConnectedTransport(): AssistantTransport {
  const notConnected = (): AssistantReply => ({
    kind: 'error',
    error: {
      code: 'not_connected',
      message: ASSISTANT_ERROR_MESSAGES.not_connected.message,
      hint: ASSISTANT_ERROR_MESSAGES.not_connected.hint,
    },
  });

  return {
    id: 'not-connected',
    label: 'Не підключено',
    async send(request, signal) {
      if (signal?.aborted) return cancelledError();
      void request;
      return notConnected();
    },
    async clarify(request, signal) {
      if (signal?.aborted) return cancelledError();
      void request;
      return notConnected();
    },
    async confirm(request, signal): Promise<AssistantConfirmResult> {
      if (signal?.aborted) return { kind: 'error', error: { code: 'cancelled', message: ASSISTANT_ERROR_MESSAGES.cancelled.message } };
      void request;
      return {
        kind: 'error',
        error: {
          code: 'not_connected',
          message: ASSISTANT_ERROR_MESSAGES.not_connected.message,
          hint: ASSISTANT_ERROR_MESSAGES.not_connected.hint,
        },
      };
    },
    cancel() {},
  };
}

// ------------------------------------------------------------
// Demo-режим: явно вмикається користувачем. Жодних реальних
// фінансових записів не створюється — лише ілюстрація чернетки.
// ------------------------------------------------------------

const DOMAIN_KEYWORDS: Array<{ domain: AssistantDomain; words: string[] }> = [
  { domain: 'clients', words: ['клієнт', 'клієнта', 'клієнту', 'замовник'] },
  { domain: 'projects', words: ['проєкт', 'проект', 'проєкту', 'замовлення'] },
  { domain: 'finance', words: ['дохід', 'витрат', 'транзакц', 'рахунок', 'баланс', 'конвертац'] },
  { domain: 'payments', words: ['оплат', 'платіж', 'передоплат'] },
  { domain: 'specialists', words: ['фахів', 'розробник', 'девелоп'] },
  { domain: 'partners', words: ['партнер', 'коміс'] },
  { domain: 'debts', words: ['борг'] },
  { domain: 'savings', words: ['відклад', 'накопич', 'ціль'] },
  { domain: 'settings', words: ['налаштуван', 'курс', 'валют'] },
  { domain: 'reports', words: ['звіт', 'статистик', 'підсум'] },
];

const CREATE_WORDS = ['створи', 'додай', 'новий', 'нова', 'запиши', 'зроби'];
const UPDATE_WORDS = ['зміни', 'онови', 'відредаг', 'постав'];
const DELETE_WORDS = ['видали', 'прибери'];
const QUERY_WORDS = ['покажи', 'скільки', 'який', 'яка', 'знайди', 'порахуй'];

function detectDomain(text: string): AssistantDomain {
  const lower = text.toLowerCase();
  for (const entry of DOMAIN_KEYWORDS) {
    if (entry.words.some(w => lower.includes(w))) return entry.domain;
  }
  return 'finance';
}

function detectAction(text: string): AssistantActionType {
  const lower = text.toLowerCase();
  if (DELETE_WORDS.some(w => lower.includes(w))) return 'delete';
  if (UPDATE_WORDS.some(w => lower.includes(w))) return 'update';
  if (QUERY_WORDS.some(w => lower.includes(w))) return 'query';
  if (CREATE_WORDS.some(w => lower.includes(w))) return 'create';
  return 'query';
}

function demoDraft(text: string): AssistantDraft {
  const domain = detectDomain(text);
  const action = detectAction(text);
  const questions = [{ key: 'name', prompt: 'Вкажіть назву або ім’я для запису', options: undefined }];

  return {
    id: `demo_${Date.now().toString(36)}`,
    domain,
    action,
    title: `${ACTION_LABELS[action]} · ${DOMAIN_LABELS[domain]}`,
    fields: [
      { key: 'name', label: 'Назва / ім’я', kind: 'text', value: '' },
      { key: 'amount', label: 'Сума', kind: 'currency', value: null, currency: 'UAH' },
      { key: 'date', label: 'Дата', kind: 'date', value: '' },
    ],
    changes: [
      { key: 'record', label: 'Запис', before: '—', after: action === 'delete' ? 'буде видалено' : 'буде створено (демо)' },
    ],
    questions,
    amount: { label: 'Сума', value: 0, currency: 'UAH' },
    route: routeForDomain(domain),
  };
}

function routeForDomain(domain: AssistantDomain): string {
  const map: Record<AssistantDomain, string> = {
    finance: '/finance',
    projects: '/projects',
    payments: '/finance',
    clients: '/clients',
    specialists: '/specialists',
    partners: '/partners',
    debts: '/debts',
    savings: '/savings',
    settings: '/settings',
    reports: '/dashboard',
  };
  return map[domain];
}

export function createDemoTransport(): AssistantTransport {
  const pending = new Set<string>();
  const check = (signal?: AbortSignal) => signal?.aborted;

  return {
    id: 'demo',
    label: 'Demo-режим',
    async send(request: AssistantSendRequest, signal) {
      if (check(signal)) return cancelledError();
      pending.add(request.requestId);
      await Promise.resolve();
      if (!pending.has(request.requestId) || check(signal)) return cancelledError();
      pending.delete(request.requestId);

      const text = request.text.trim();
      if (!text) {
        return { kind: 'error', error: { code: 'invalid_response', message: ASSISTANT_ERROR_MESSAGES.invalid_response.message } };
      }
      const action = detectAction(text);
      if (action === 'query') {
        return {
          kind: 'text',
          text: 'DEMO-режим: запитання обробляються лише для прикладу. Реальні дані не читаються, підключення провайдера немає.',
        };
      }
      const draft = demoDraft(text);
      return {
        kind: 'clarify',
        text: 'DEMO-режим: це лише ілюстрація чернетки. Запис НЕ буде створено без підтвердження провайдера.',
        questions: draft.questions,
      };
    },
    async clarify(request: AssistantClarifyRequest, signal) {
      if (check(signal)) return cancelledError();
      pending.delete(request.draftId);
      return { kind: 'draft', draft: demoDraft(request.text || 'створи запис') };
    },
    async confirm(request: AssistantConfirmRequest, signal): Promise<AssistantConfirmResult> {
      if (check(signal)) return { kind: 'error', error: { code: 'cancelled', message: ASSISTANT_ERROR_MESSAGES.cancelled.message } };
      void request;
      // Демо ніколи не створює реальних записів.
      return {
        kind: 'demo',
        domain: 'finance',
        summary: 'Демо-режим: жодного запису не створено. Підключіть провайдера, щоб виконувати дії.',
      };
    },
    cancel(requestId: string) {
      pending.delete(requestId);
    },
  };
}

export function getTransport(settings: ProviderSettings): AssistantTransport {
  return settings.demo ? createDemoTransport() : ['opencode','openrouter'].includes(settings.provider) ? createRemoteTransport() : createNotConnectedTransport();
}
