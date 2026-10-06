// ============================================================
// Типізований транспортний контракт AI-помічника.
// Етап 1: UI + контракти. Реальний провайдер НЕ підключено —
// серверні функції з'являться на етапі 2 (той самий контракт).
// Секрети (API-ключі) в контракті не передаються і не зберігаються.
// ============================================================

export const ASSISTANT_DOMAINS = [
  'finance', 'projects', 'payments', 'clients', 'specialists',
  'partners', 'debts', 'savings', 'settings', 'reports',
] as const;
export type AssistantDomain = (typeof ASSISTANT_DOMAINS)[number];

export const DOMAIN_LABELS: Record<AssistantDomain, string> = {
  finance: 'Фінанси',
  projects: 'Проєкти',
  payments: 'Оплати',
  clients: 'Клієнти',
  specialists: 'Фахівці',
  partners: 'Партнери',
  debts: 'Борги',
  savings: 'Накопичення',
  settings: 'Налаштування',
  reports: 'Звіти',
};

export type AssistantActionType = 'create' | 'update' | 'delete' | 'query';

export const ACTION_LABELS: Record<AssistantActionType, string> = {
  create: 'Створити',
  update: 'Змінити',
  delete: 'Видалити',
  query: 'Показати',
};

export type FieldKind = 'text' | 'number' | 'date' | 'currency' | 'percent' | 'select' | 'boolean';

export interface AssistantField {
  key: string;
  label: string;
  kind: FieldKind;
  value: string | number | boolean | null;
  /** Можливі значення для select. */
  options?: string[];
  currency?: string;
}

export interface AssistantChange {
  key: string;
  label: string;
  before?: string;
  after?: string;
}

export interface AssistantQuestion {
  key: string;
  prompt: string;
  options?: string[];
}

export interface AssistantAmount {
  label: string;
  value: number;
  currency: string;
}

/** Чернетка дії: що саме буде зроблено і що зміниться. */
export interface AssistantDraft {
  id: string;
  domain: AssistantDomain;
  action: AssistantActionType;
  title: string;
  fields: AssistantField[];
  changes: AssistantChange[];
  questions: AssistantQuestion[];
  amount?: AssistantAmount;
  /** Ідентифікатор існуючого запису (update/delete/query). */
  recordId?: string;
  /** Сторінка, куди можна перейти після успіху. */
  route?: string;
}

export type AssistantRole = 'user' | 'assistant' | 'system';

export interface AssistantMessage {
  id: string;
  role: AssistantRole;
  text: string;
  at: string;
  draftId?: string;
  /** Повідомлення про помилку транспорту. */
  errorCode?: AssistantErrorCode;
}

export type AssistantErrorCode =
  | 'not_connected'
  | 'invalid_key'
  | 'quota_exceeded'
  | 'insufficient_credits'
  | 'timeout'
  | 'model_incompatible'
  | 'unavailable'
  | 'cancelled'
  | 'invalid_response'
  | 'demo_only';

export interface AssistantError {
  code: AssistantErrorCode;
  message: string;
  hint?: string;
}

export const ASSISTANT_ERROR_MESSAGES: Record<AssistantErrorCode, { message: string; hint: string }> = {
  not_connected: {
    message: 'Помічник ще не підключений',
    hint: 'Серверна функція буде підключена на етапі 2.',
  },
  invalid_key: {
    message: 'Недійсний API-ключ',
    hint: 'Перевірте ключ провайдера. До підключення захищеного сховища ключі не зберігаються.',
  },
  quota_exceeded: {
    message: 'Перевищено квоту провайдера',
    hint: 'Спробуйте пізніше або змініть модель/провайдера.',
  },
  insufficient_credits: {
    message: 'Недостатньо кредитів на рахунку провайдера',
    hint: 'Поповніть баланс у кабінеті провайдера.',
  },
  timeout: {
    message: 'Перевищено час очікування відповіді',
    hint: 'Спробуйте ще раз або скоротіть запит.',
  },
  model_incompatible: {
    message: 'Модель несумісна з цією дією',
    hint: 'Оберіть іншу модель у налаштуваннях провайдера.',
  },
  unavailable: {
    message: 'Сервіс провайдера тимчасово недоступний',
    hint: 'Перевірте статус провайдера та спробуйте пізніше.',
  },
  cancelled: {
    message: 'Запит скасовано',
    hint: 'Ви саме скасували очікування відповіді.',
  },
  invalid_response: {
    message: 'Провайдер повернув непридатну відповідь',
    hint: 'Спробуйте переформулювати запит.',
  },
  demo_only: {
    message: 'Демо-режим: справжній запис не виконується',
    hint: 'Вимкніть demo-режим після підключення провайдера.',
  },
};

// ------------------------------------------------------------
// Провайдер і модель (без ключів)
// ------------------------------------------------------------

export const PROVIDERS = ['openrouter', 'opencode', 'openai', 'anthropic', 'google', 'custom'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openrouter: 'OpenRouter',
  opencode: 'OpenCode Zen',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  custom: 'Власний endpoint',
};

export interface ProviderModel {
  id: string;
  label: string;
}

export const PROVIDER_MODELS: Record<ProviderId, ProviderModel[]> = {
  openrouter: [{id:'openrouter/free',label:'Free Models Router'}],
  opencode: [{id:'mimo-v2.6-flash-free',label:'MiMo V2.6 Flash Free'}],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
  ],
  anthropic: [
    { id: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet' },
    { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
  ],
  google: [
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  ],
  custom: [{ id: 'custom-model', label: 'Власна модель' }],
};

/** Налаштування провайдера. НІКОЛИ не містить API-ключ. */
export interface ProviderSettings {
  provider: ProviderId;
  model: string;
  baseUrl?: string;
  demo: boolean;
}

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  provider: 'openrouter',
  model: 'openrouter/free',
  demo: false,
};

/** Введення ключа — передається лише в пам'яті, нікуди не зберігається. */
export interface ProviderKeyInput {
  provider: ProviderId;
  key: string;
}

export interface KeyCheckResult {
  ok: boolean;
  message: string;
  /** Завжди false: ключ не зберігається на етапі 1. */
  persisted: false;
}

// ------------------------------------------------------------
// Запити/відповіді
// ------------------------------------------------------------

export interface AssistantSendRequest {
  requestId: string;
  text: string;
  history: AssistantMessage[];
  provider: ProviderId;
  model: string;
}

export interface AssistantClarifyRequest extends AssistantSendRequest {
  draftId: string;
  answers: Record<string, string>;
}

export interface AssistantConfirmRequest {
  requestId: string;
  draftId: string;
  /** Виправлення чернетки користувачем перед підтвердженням. */
  corrections?: Record<string, string | number | boolean | null>;
}

export type AssistantReply =
  | { kind: 'text'; text: string }
  | { kind: 'draft'; draft: AssistantDraft }
  | { kind: 'clarify'; text: string; questions: AssistantQuestion[] }
  | { kind: 'error'; error: AssistantError };

export type AssistantConfirmResult =
  | { kind: 'applied'; domain: AssistantDomain; recordId: string; route?: string; summary: string }
  /** Demo-режим: жодного реального запису не створено. */
  | { kind: 'demo'; domain: AssistantDomain; summary: string }
  | { kind: 'error'; error: AssistantError };

/**
 * Транспорт повідомлень між UI та (майбутніми) серверними функціями.
 * Реалізації: `not-connected` (типова) та `demo` (лише явний demo-режим).
 */
export interface AssistantTransport {
  readonly id: 'not-connected' | 'demo' | 'remote';
  readonly label: string;
  send(request: AssistantSendRequest, signal?: AbortSignal): Promise<AssistantReply>;
  clarify(request: AssistantClarifyRequest, signal?: AbortSignal): Promise<AssistantReply>;
  confirm(request: AssistantConfirmRequest, signal?: AbortSignal): Promise<AssistantConfirmResult>;
  cancel(requestId: string): void;
}

// ------------------------------------------------------------
// Голосовий ввід
// ------------------------------------------------------------

export type VoiceStatus =
  | 'idle'
  | 'unsupported'
  | 'requesting'
  | 'recording'
  | 'processing'
  | 'ready'
  | 'denied'
  | 'error';

export interface VoiceState {
  status: VoiceStatus;
  /** Попередній перегляд транскрипції (редагується користувачем). */
  transcript: string;
  /** Посилання на записане аудіо для прослуховування (локальне, у пам'яті). */
  audioUrl?: string;
  message?: string;
}

export const VOICE_MESSAGES: Record<Exclude<VoiceStatus, 'idle' | 'ready'>, string> = {
  unsupported: 'Браузер не підтримує запис голосу або розпізнавання мови',
  requesting: 'Запит доступу до мікрофона…',
  recording: 'Запис… натисніть щоб зупинити',
  processing: 'Обробка запису…',
  denied: 'Доступ до мікрофона заборонено — у налаштуваннях браузера можна дозволити',
  error: 'Не вдалося записати голос',
};
