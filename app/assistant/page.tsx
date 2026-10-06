'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ChatPanel from '@/components/assistant/ChatPanel';
import ProviderSettingsCard from '@/components/assistant/ProviderSettingsCard';
import {
  ASSISTANT_ERROR_MESSAGES,
  DEFAULT_PROVIDER_SETTINGS,
  type AssistantConfirmResult,
  type AssistantDraft,
  type AssistantMessage,
  type AssistantReply,
  type ProviderSettings,
} from '@/lib/assistant/contract';
import { loadProviderSettings, saveProviderSettings, assertNoStoredSecrets } from '@/lib/assistant/prefs';
import { getTransport } from '@/lib/assistant/transport';
import { usePersistedState } from '@/hooks/useUiState';
import { emitToast } from '@/lib/toast-bus';

const HISTORY_KEY = 'crm:assistant:history';

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function loadHistory(): AssistantMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter(m => m && typeof m.text === 'string') : [];
  } catch {
    return [];
  }
}

function saveHistory(messages: AssistantMessage[]): void {
  try {
    sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-100)));
  } catch {
    // Історія не критична — працюємо без збереження.
  }
}

export default function AssistantPage() {
  const [tab, setTab] = usePersistedState<'chat' | 'settings'>('assistant:tab', 'chat');
  const [settings, setSettings] = useState<ProviderSettings>({ ...DEFAULT_PROVIDER_SETTINGS });
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState<AssistantDraft | null>(null);
  const [clarify, setClarify] = useState<{
    text: string;
    questions: { key: string; prompt: string; options?: string[] }[];
    /** Оригінальна команда користувача — щоб чернетка будувалася від неї. */
    source: string;
  }>({ text: '', questions: [], source: '' });
  const [result, setResult] = useState<AssistantConfirmResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setSettings(loadProviderSettings());
    setMessages(loadHistory());
    const leaked = assertNoStoredSecrets();
    if (leaked.length) {
      emitToast(`У локальному сховищі знайдено службові ключі: ${leaked.join(', ')}`, 'error');
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) saveHistory(messages);
  }, [messages, mounted]);

  const transport = useMemo(() => getTransport(settings), [settings]);

  const pushMessage = useCallback((message: Omit<AssistantMessage, 'id' | 'at'>) => {
    setMessages(prev => [...prev, { ...message, id: newId('m'), at: new Date().toISOString() }]);
  }, []);

  const handleReply = useCallback((reply: AssistantReply) => {
    if (reply.kind === 'text') {
      pushMessage({ role: 'assistant', text: reply.text });
      return;
    }
    if (reply.kind === 'draft') {
      setDraft(reply.draft);
      pushMessage({ role: 'assistant', text: `Чернетка готова: ${reply.draft.title}` });
      return;
    }
    if (reply.kind === 'clarify') {
      setClarify(prev => ({ text: reply.text, questions: reply.questions, source: prev.source }));
      pushMessage({ role: 'assistant', text: reply.text });
      return;
    }
    pushMessage({ role: 'assistant', text: reply.error.message, errorCode: reply.error.code });
  }, [pushMessage]);

  const sendCommand = useCallback(async (text: string) => {
    pushMessage({ role: 'user', text });
    setClarify({ text: '', questions: [], source: text });
    setResult(null);
    const requestId = newId('req');
    requestIdRef.current = requestId;
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    try {
      // Провайдер/модель фіксуються на момент запиту: перемикання
      // провайдера не втрачає незавершену команду.
      const reply = await transport.send({
        requestId,
        text,
        history: messages,
        provider: settings.provider,
        model: settings.model,
      }, controller.signal);
      handleReply(reply);
    } catch (err) {
      pushMessage({
        role: 'assistant',
        text: ASSISTANT_ERROR_MESSAGES.unavailable.message,
        errorCode: 'unavailable',
      });
      void err;
    } finally {
      setPending(false);
      abortRef.current = null;
    }
  }, [handleReply, messages, pushMessage, settings.model, settings.provider, transport]);

  const cancelPending = useCallback(() => {
    abortRef.current?.abort();
    transport.cancel(requestIdRef.current);
    setPending(false);
    pushMessage({ role: 'system', text: ASSISTANT_ERROR_MESSAGES.cancelled.message, errorCode: 'cancelled' });
  }, [pushMessage, transport]);

  const answerClarify = useCallback(async (answers: Record<string, string>) => {
    if (!clarify.questions.length) return;
    const source = clarify.source;
    setClarify({ text: '', questions: [], source: '' });
    const requestId = newId('req');
    requestIdRef.current = requestId;
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    try {
      const reply = await transport.clarify({
        requestId,
        draftId: 'clarify',
        text: source || Object.entries(answers).map(([k, v]) => `${k}: ${v}`).join(', '),
        history: messages,
        provider: settings.provider,
        model: settings.model,
        answers,
      }, controller.signal);
      handleReply(reply);
    } finally {
      setPending(false);
      abortRef.current = null;
    }
  }, [clarify.questions, clarify.source, handleReply, messages, settings.model, settings.provider, transport]);

  const correctDraft = useCallback((key: string, value: string | number | boolean | null) => {
    setDraft(prev => {
      if (!prev) return prev;
      const fields = prev.fields.map(f => (f.key === key ? { ...f, value } : f));
      const label = prev.fields.find(f => f.key === key)?.label || key;
      const changes = prev.changes.some(c => c.key === key)
        ? prev.changes.map(c => (c.key === key ? { ...c, after: value === null || value === '' ? '—' : String(value) } : c))
        : [...prev.changes, { key, label, before: '—', after: value === null || value === '' ? '—' : String(value) }];
      return { ...prev, fields, changes };
    });
  }, []);

  const confirmDraft = useCallback(async () => {
    if (!draft) return;
    const requestId = newId('req');
    const controller = new AbortController();
    abortRef.current = controller;
    setPending(true);
    try {
      const corrections = Object.fromEntries(draft.fields.map(f => [f.key, f.value]));
      const outcome = await transport.confirm({ requestId, draftId: draft.id, corrections }, controller.signal);
      setResult(outcome);
      if (outcome.kind === 'applied') {
        pushMessage({ role: 'assistant', text: `Готово: ${outcome.summary}` });
      } else if (outcome.kind === 'demo') {
        pushMessage({ role: 'assistant', text: `DEMO: ${outcome.summary}` });
      } else {
        pushMessage({ role: 'assistant', text: outcome.error.message, errorCode: outcome.error.code });
      }
      setDraft(null);
    } finally {
      setPending(false);
      abortRef.current = null;
    }
  }, [draft, pushMessage, transport]);

  const discardDraft = useCallback(() => {
    setDraft(null);
    setClarify({ text: '', questions: [], source: '' });
    pushMessage({ role: 'system', text: 'Чернетку скасовано. Дані не змінено.' });
  }, [pushMessage]);

  // Перемикання провайдера не чіпає поточну команду/чернетку:
  // налаштування змінюються окремо, state чату лишається.
  const saveSettings = useCallback((next: ProviderSettings) => {
    const safe = saveProviderSettings(next);
    setSettings(safe);
    emitToast(`Провайдер: ${safe.provider} · модель ${safe.model} (ключ не збережено)`, 'success');
  }, []);

  const clearHistory = () => {
    setMessages([]);
    setDraft(null);
    setClarify({ text: '', questions: [], source: '' });
    setResult(null);
    try { sessionStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  };

  return (
    <section className="page active">
      <div className="page-header">
        <div>
          <h1 className="page-title">AI-помічник</h1>
          <p className="page-subtitle">Голос та тексти · дії над даними CRM</p>
        </div>
        <div className="header-actions">
          <button className={`btn ${tab === 'chat' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('chat')}>Чат</button>
          <button className={`btn ${tab === 'settings' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('settings')}>Налаштування</button>
          {tab === 'chat' && (
            <button className="btn btn-ghost" onClick={clearHistory}>Очистити історію</button>
          )}
        </div>
      </div>

      {tab === 'chat' ? (
        <ChatPanel
          messages={messages}
          pending={pending}
          draft={draft}
          clarifyText={clarify.text}
          clarifyQuestions={clarify.questions}
          result={result}
          settings={settings}
          onSend={sendCommand}
          onCancel={cancelPending}
          onAnswer={answerClarify}
          onCorrect={correctDraft}
          onConfirm={confirmDraft}
          onDiscard={discardDraft}
          onDismissResult={() => setResult(null)}
        />
      ) : (
        <div className="settings-grid">
          <ProviderSettingsCard settings={settings} onSave={saveSettings} />
          <div className="settings-card">
            <h3 className="settings-title">Що вже працює</h3>
            <ul className="ai-capability-list">
              <li>Чат, надсилання команди, скасування очікування, історія</li>
              <li>Чернетка дії: сутність, поля, суми, що зміниться</li>
              <li>Уточнення користувача та виправлення чернетки</li>
              <li>Результат із переходом до запису</li>
              <li>Активний провайдер і модель, екран налаштувань</li>
              <li>Повідомлення про недійсний ключ, квоту, кредити, таймаут, несумісну модель і недоступність</li>
              <li>Перемикання провайдера зі збереженням незавершеної команди</li>
              <li>Голосовий ввід: запис/зупинка, перегляд транскрипції, відмова доступу, відсутність підтримки браузера</li>
            </ul>
            <p className="settings-text" style={{ marginTop: 10 }}>
              Не підключено на етапі 1: реальний провайдер, серверні функції, збереження API-ключів,
              виконання фінансових дій через AI.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
