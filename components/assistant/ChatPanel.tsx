'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type {
  AssistantConfirmResult, AssistantDraft, AssistantField, AssistantMessage,
  AssistantQuestion, ProviderSettings,
} from '@/lib/assistant/contract';
import { ACTION_LABELS, DOMAIN_LABELS, PROVIDER_LABELS, ASSISTANT_ERROR_MESSAGES } from '@/lib/assistant/contract';
import { useVoiceInput } from '@/hooks/useVoiceInput';
import MarkdownMessage from './MarkdownMessage';

interface ChatPanelProps {
  messages: AssistantMessage[];
  pending: boolean;
  draft: AssistantDraft | null;
  clarifyText: string;
  clarifyQuestions: AssistantQuestion[];
  result: AssistantConfirmResult | null;
  settings: ProviderSettings;
  onSend: (text: string) => void;
  onCancel: () => void;
  onAnswer: (answers: Record<string, string>) => void;
  onCorrect: (key: string, value: string | number | boolean | null) => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onDismissResult: () => void;
}

function formatFieldValue(field: AssistantField): string {
  if (field.value === null || field.value === undefined || field.value === '') return '—';
  if (field.kind === 'currency') return `${field.value} ${field.currency || ''}`.trim();
  if (field.kind === 'percent') return `${field.value}%`;
  return String(field.value);
}

export default function ChatPanel(props: ChatPanelProps) {
  const { messages, pending, draft, clarifyText, clarifyQuestions, result, settings } = props;
  const [text, setText] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [voicePreview, setVoicePreview] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const [showVoice, setShowVoice] = useState(false);

  const voice = useVoiceInput(value => setText(prev => (prev ? `${prev} ${value}` : value)));

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending, draft]);

  useEffect(() => {
    if (voice.state.transcript) setVoicePreview(voice.state.transcript);
  }, [voice.state.transcript]);

  const send = () => {
    const value = text.trim();
    if (!value || pending) return;
    props.onSend(value);
    setText('');
  };

  const submitAnswers = () => {
    props.onAnswer(answers);
    setAnswers({});
  };

  const startVoice = () => {
    setShowVoice(true);
    if (voice.state.status === 'recording') voice.stop();
    else void voice.start();
  };

  return (
    <div className="ai-chat">
      <div className="ai-chat-head">
        <div className="ai-provider-badge">
          <span className={`ai-provider-dot${settings.demo ? ' ai-provider-dot--demo' : ''}`} />
          <span>{PROVIDER_LABELS[settings.provider]}</span>
          <span className="ai-provider-model">{settings.model}</span>
          {settings.demo && <span className="badge badge--orange">DEMO</span>}
        </div>
        {!settings.demo && settings.provider === 'opencode' && <span className="ai-not-connected">MiMo Free: прямий API недоступний</span>}
        {!settings.demo && !['opencode','openrouter'].includes(settings.provider) && (
          <span className="ai-not-connected">Помічник ще не підключений</span>
        )}
      </div>

      <div className="ai-messages" ref={listRef} role="log" aria-label="Історія розмови" aria-live="polite" aria-relevant="additions">
        {messages.length === 0 && (
          <div className="ai-empty">
            <p>Напишіть команду: «покажи борги», «створи клієнта», «який баланс».</p>
            <p className="ai-empty-hint">
              Зміни спочатку з’являться як чернетка. Перевірте поля й підтвердьте запис.
            </p>
          </div>
        )}

        {messages.map(m => (
          <div key={m.id} className={`ai-msg ai-msg--${m.role}${m.errorCode ? ' ai-msg--error' : ''}`}>
            <div className="ai-msg-text">{m.role === 'assistant' && !m.errorCode ? <MarkdownMessage text={m.text} /> : m.text}</div>
            {m.errorCode && ASSISTANT_ERROR_MESSAGES[m.errorCode] && (
              <div className="ai-msg-hint">{ASSISTANT_ERROR_MESSAGES[m.errorCode].hint}</div>
            )}
          </div>
        ))}

        {pending && (
          <div className="ai-msg ai-msg--assistant ai-msg--pending">
            <span className="ai-typing"><i /><i /><i /></span>
            {!draft && <button className="btn btn-ghost btn--sm" onClick={props.onCancel}>Скасувати</button>}
          </div>
        )}

        {clarifyQuestions.length > 0 && !draft && (
          <div className="ai-clarify">
            <div className="ai-msg-text"><MarkdownMessage text={clarifyText} /></div>
            {clarifyQuestions.map(q => (
              <div className="ai-field" key={q.key}>
                <label className="form-label">{q.prompt}</label>
                {q.options?.length ? (
                  <select className="form-input" value={answers[q.key] || ''} onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}>
                    <option value="">—</option>
                    {q.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input
                    className="form-input"
                    value={answers[q.key] || ''}
                    onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
            <div className="ai-actions">
              <button className="btn btn-primary" onClick={submitAnswers}>Відповісти</button>
            </div>
          </div>
        )}

        {result && (
          <div className={`ai-result ai-result--${result.kind}`}>
            {result.kind === 'applied' && (
              <>
                <strong>Готово.</strong> {result.summary}
                {result.route && (
                  <div style={{ marginTop: 8 }}>
                    <Link className="btn btn-ghost btn--sm" href={result.route}>Перейти до запису</Link>
                  </div>
                )}
              </>
            )}
            {result.kind === 'demo' && (
              <>
                <strong>Демо-режим.</strong> {result.summary} Реальний запис не створено.
              </>
            )}
            {result.kind === 'error' && (
              <>
                <strong>{result.error.message}</strong>
                {result.error.hint && <div className="ai-msg-hint">{result.error.hint}</div>}
              </>
            )}
            <button className="btn btn-ghost btn--sm" onClick={props.onDismissResult} style={{ marginLeft: 10 }}>Закрити</button>
          </div>
        )}

        {draft && (
          <div className="ai-draft">
            <div className="ai-draft-head">
              <span className="badge badge--blue">{DOMAIN_LABELS[draft.domain]}</span>
              <span className="badge badge--purple">{ACTION_LABELS[draft.action]}</span>
              <strong>{draft.title}</strong>
            </div>

            {draft.amount && (
              <div className="ai-draft-amount">
                {draft.amount.label}: <strong>{draft.amount.value} {draft.amount.currency}</strong>
              </div>
            )}

            <div className="ai-draft-fields">
              {draft.fields.map(f => (
                <div className="ai-field" key={f.key}>
                  <label className="form-label">{f.label}</label>
                  {f.kind === 'boolean' ? (<input type="checkbox" checked={f.value === true} disabled={pending} onChange={e=>props.onCorrect(f.key,e.target.checked)}/>) : f.kind === 'select' && f.options ? (
                    <select
                      className="form-input"
                      value={String(f.value ?? '')}
                      onChange={e => props.onCorrect(f.key, e.target.value)}
                    >
                      <option value="">—</option>
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      className="form-input"
                      disabled={pending}
                      type={f.kind === 'number' || f.kind === 'currency' || f.kind === 'percent' ? 'number' : f.kind === 'date' ? 'date' : 'text'}
                      value={f.value === null || f.value === undefined ? '' : String(f.value)}
                      onChange={e => props.onCorrect(f.key, e.target.value)}
                    />
                  )}
                  <span className="ai-field-current">{formatFieldValue(f)}</span>
                </div>
              ))}
            </div>

            <div className="ai-draft-changes">
              <div className="ai-draft-changes-title">Що зміниться</div>
              <ul>
                {draft.changes.map(c => (
                  <li key={c.key}>
                    <span>{c.label}</span>
                    <span className="ai-change-flow">{c.before ?? '—'} → {c.after ?? '—'}</span>
                  </li>
                ))}
                {draft.changes.length === 0 && <li>Змін не визначено</li>}
              </ul>
            </div>

            <div className="ai-actions">
              <button className="btn btn-primary" disabled={pending} onClick={props.onConfirm}>Підтвердити</button>
              <button className="btn btn-ghost" disabled={pending} onClick={props.onDiscard}>Скасувати</button>
            </div>
          </div>
        )}
      </div>

      {showVoice && (
        <div className="ai-voice">
          <div className="ai-voice-row">
            <button
              className={`btn btn--sm ${voice.state.status === 'recording' ? 'btn-danger' : 'btn-ghost'}`}
              onClick={startVoice}
              disabled={voice.state.status === 'requesting' || voice.state.status === 'processing'}
            >
              {voice.state.status === 'recording' ? '■ Зупинити запис' : '● Записати голос'}
            </button>
            {voice.state.audioUrl && (
              <audio className="ai-voice-audio" controls src={voice.state.audioUrl} />
            )}
            {(voice.state.status === 'denied' || voice.state.status === 'unsupported' || voice.state.status === 'error') && (
              <span className="ai-voice-error">{voice.state.message}</span>
            )}
          </div>
          {voice.state.transcript && (
            <div className="ai-voice-preview">
              <label className="form-label">Транскрипція (перегляньте та відредагуйте)</label>
              <textarea
                className="form-input form-textarea"
                rows={2}
                value={voicePreview}
                onChange={e => setVoicePreview(e.target.value)}
              />
              <div className="ai-actions">
                <button className="btn btn-ghost btn--sm" onClick={() => {
                  const value = voicePreview.trim();
                  if (value) setText(prev => (prev ? `${prev} ${value}` : value));
                  voice.reset();
                  setVoicePreview('');
                }}>Вставити в повідомлення</button>
                <button className="btn btn-ghost btn--sm" onClick={() => { voice.reset(); setVoicePreview(''); }}>Скасувати</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="ai-composer">
        <button
          className="btn-icon"
          title="Голосовий ввід"
          aria-label="Голосовий ввід"
          onClick={() => (showVoice && voice.state.status === 'idle' ? setShowVoice(false) : startVoice())}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="currentColor" strokeWidth="2"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <textarea
          className="form-input ai-composer-input"
          rows={2}
          aria-label="Повідомлення помічнику"
          placeholder="Напишіть команду помічнику…"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {pending ? (
          <button className="btn btn-ghost" onClick={props.onCancel}>Скасувати</button>
        ) : (
          <button className="btn btn-primary" onClick={send} disabled={!text.trim()}>Надіслати</button>
        )}
      </div>
    </div>
  );
}
