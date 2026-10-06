'use client';
import { useState } from 'react';
import type { KeyCheckResult, ProviderId, ProviderSettings } from '@/lib/assistant/contract';
import { PROVIDERS, PROVIDER_LABELS, PROVIDER_MODELS } from '@/lib/assistant/contract';
import { checkKeyFormat } from '@/lib/assistant/prefs';

interface ProviderSettingsCardProps {
  settings: ProviderSettings;
  onSave: (settings: ProviderSettings) => void;
}

const DEMO_STORAGE_KEY = 'crm_assistant_provider';

export default function ProviderSettingsCard({ settings, onSave }: ProviderSettingsCardProps) {
  const [provider, setProvider] = useState<ProviderId>(settings.provider);
  const [model, setModel] = useState(settings.model);
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl || '');
  const [demo, setDemo] = useState(settings.demo);
  const [keyValue, setKeyValue] = useState('');
  const [check, setCheck] = useState<KeyCheckResult | null>(null);
  const [saved, setSaved] = useState(false);

  const models = PROVIDER_MODELS[provider];

  const handleProviderChange = (next: ProviderId) => {
    // Перемикання провайдера зберігає незавершену команду:
    // сторінка зберігає чернетку/текст окремо, тут лише міняється профіль.
    setProvider(next);
    setModel(PROVIDER_MODELS[next][0].id);
    setCheck(null);
    setSaved(false);
  };

  const runCheck = () => {
    setCheck(checkKeyFormat({ provider, key: keyValue }));
    setSaved(false);
  };

  const save = () => {
    onSave({ provider, model, baseUrl: baseUrl || undefined, demo });
    setSaved(true);
  };

  return (
    <div className="settings-card">
      <h3 className="settings-title">Провайдер та модель</h3>
      <p className="settings-text">
        Оберіть провайдера і модель для AI-помічника. Налаштування зберігаються локально.
      </p>

      <div className="form-grid" style={{ marginTop: 12 }}>
        <div className="form-group">
          <label className="form-label">Провайдер</label>
          <select className="form-input" value={provider} onChange={e => handleProviderChange(e.target.value as ProviderId)}>
            {PROVIDERS.map(p => <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Модель</label>
          <select className="form-input" value={model} onChange={e => { setModel(e.target.value); setSaved(false); }}>
            {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        {provider === 'custom' && (
          <div className="form-group form-group--full">
            <label className="form-label">Base URL</label>
            <input className="form-input" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://…" />
          </div>
        )}
        <div className="form-group form-group--full">
          <label className="form-label">API-ключ (перевірка формату)</label>
          <div className="ai-key-row">
            <input
              className="form-input"
              type="password"
              autoComplete="off"
              value={keyValue}
              onChange={e => { setKeyValue(e.target.value); setCheck(null); }}
              placeholder="Вставте ключ для перевірки"
            />
            <button className="btn btn-ghost" onClick={runCheck} disabled={!keyValue}>Перевірити</button>
          </div>
          {check && (
            <small className="form-hint" style={{ color: check.ok ? 'var(--accent-green)' : 'var(--danger)' }}>
              {check.message}
            </small>
          )}
          <small className="form-hint">
            Ключ не зберігається: ні у localStorage, ні у sessionStorage, ні в URL, ні в логах, ні в резервній копії.
            Захищене серверне сховище ключів додається на етапі 2 (див. .env.example).
          </small>
        </div>
        <div className="form-group form-group--full">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={demo} onChange={e => { setDemo(e.target.checked); setSaved(false); }} />
            Demo-режим (без реальних записів)
          </label>
          <small className="form-hint">
            У demo-режимі помічник показує ілюстрацію чернеток і ніколи не створює справжні фінансові записи.
          </small>
        </div>
      </div>

      <div className="header-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save}>Зберегти налаштування</button>
        {saved && <span style={{ color: 'var(--accent-green)', fontSize: '0.85rem' }}>Збережено (без ключа)</span>}
      </div>

      <p className="settings-text" style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
        Службовий ключ налаштувань: <code>{DEMO_STORAGE_KEY}</code> — містить лише провайдер, модель і прапорець demo.
      </p>
    </div>
  );
}
