'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ProviderId } from '@/lib/lead-generator/types';

interface ProviderMeta {
  id: ProviderId;
  label: string;
  keyHint: string;
  defaultModel: string;
}

interface KeyStatus {
  masked: string;
  hasKey: boolean;
  fromEnv: boolean;
}

interface SettingsResponse {
  provider: ProviderId;
  model: string;
  providers: ProviderMeta[];
  keys: Record<ProviderId, KeyStatus>;
}

interface ModelsResponse {
  provider: ProviderId;
  hasApiKey: boolean;
  models: { id: string; label?: string }[];
  defaultModel: string;
  source: 'live' | 'cache' | 'fallback';
  error?: string;
  maskedApiKey?: string;
}

export default function SettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [modelSearch, setModelSearch] = useState('');

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/lead-generator/settings');
      if (res.ok) {
        const data: SettingsResponse = await res.json();
        setSettings(data);
        setSelectedProvider((prev) => prev ?? data.provider);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const activeProvider = selectedProvider ?? settings?.provider ?? 'openrouter';
  const activeMeta = settings?.providers.find((p) => p.id === activeProvider);
  const activeKey = settings?.keys[activeProvider];

  const filteredModels = useMemo(() => {
    const list = models?.models ?? [];
    const query = modelSearch.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (m) => m.id.toLowerCase().includes(query) || (m.label || '').toLowerCase().includes(query)
    );
  }, [models, modelSearch]);

  const loadModels = useCallback(
    async (provider: ProviderId, refresh = false) => {
      setLoadingModels(true);
      setModels(null);
      setModelSearch('');
      try {
        const res = await fetch(`/api/lead-generator/models?provider=${provider}${refresh ? '&refresh=1' : ''}`);
        if (res.ok) setModels(await res.json());
      } catch {
        // ignore
      } finally {
        setLoadingModels(false);
      }
    },
    []
  );

  useEffect(() => {
    if (activeProvider && settings) loadModels(activeProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProvider, settings?.provider]);

  const save = async (payload: Record<string, unknown>, okText: string) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/lead-generator/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await loadSettings();
        setMessage({ kind: 'ok', text: okText });
        onSaved?.();
      } else {
        const err = await res.json().catch(() => ({ error: 'Помилка збереження' }));
        setMessage({ kind: 'err', text: err.error || 'Помилка збереження' });
      }
    } finally {
      setSaving(false);
    }
  };

  const saveKey = async () => {
    if (!apiKeyInput.trim()) return;
    await save({ provider: activeProvider, apiKey: apiKeyInput.trim(), keyProvider: activeProvider }, 'Ключ збережено');
    setApiKeyInput('');
    loadModels(activeProvider, true);
  };

  const saveModel = async (model: string) => {
    await save({ provider: activeProvider, model, keyProvider: activeProvider }, `Модель: ${model}`);
  };

  const switchProvider = async (provider: ProviderId) => {
    setSelectedProvider(provider);
    const meta = settings?.providers.find((p) => p.id === provider);
    if (meta) await save({ provider, model: meta.defaultModel }, `Провайдер: ${meta.label}`);
    loadModels(provider);
  };

  if (!settings) return <div className="lg-hint">Завантаження налаштувань…</div>;

  return (
    <div className="lg-settings-panel">
      <div className="lg-field">
        <label className="lg-label">AI-провайдер</label>
        <div className="lg-chip-row">
          {settings.providers.map((p) => (
            <button
              key={p.id}
              className={`lg-provider-chip${p.id === activeProvider ? ' lg-provider-chip--active' : ''}${settings.keys[p.id]?.hasKey ? ' lg-provider-chip--haskey' : ''}`}
              onClick={() => switchProvider(p.id)}
              disabled={saving}
              title={settings.keys[p.id]?.hasKey ? 'Ключ налаштований' : 'Без ключа'}
            >
              {p.label}
              {settings.keys[p.id]?.hasKey && <span className="lg-provider-dot" />}
            </button>
          ))}
        </div>
      </div>

      <div className="lg-settings-grid">
        <div className="lg-field">
          <label className="lg-label">
            API-ключ {activeMeta?.label}{' '}
            {activeKey?.hasKey && (
              <span className="lg-hint">
                (збережено: {activeKey.masked}
                {activeKey.fromEnv ? ', з env' : ''})
              </span>
            )}
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="lg-input"
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={`${activeMeta?.keyHint || 'ключ'} — залиште порожнім, щоб не змінювати`}
              autoComplete="off"
            />
            <button className="btn btn-ghost" onClick={saveKey} disabled={saving || !apiKeyInput.trim()}>
              Зберегти
            </button>
            {activeKey?.hasKey && !activeKey.fromEnv && (
              <button
                className="btn btn-ghost"
                onClick={async () => {
                  await save({ clearKey: true, keyProvider: activeProvider }, 'Ключ видалено');
                  loadModels(activeProvider, true);
                }}
                disabled={saving}
                title="Видалити збережений ключ"
              >
                ✕
              </button>
            )}
          </div>
          <span className="lg-hint">
            Ключі зберігаються локально в БД Lead Generator. Для {activeMeta?.label} можна також задати env-змінну{' '}
            <code>{activeProvider.toUpperCase()}_API_KEY</code>.
          </span>
        </div>

        <div className="lg-field">
          <label className="lg-label">
            Модель{' '}
            {models && models.source !== 'fallback' && (
              <span className="lg-hint">
                ({models.source === 'live' ? 'завантажено з API' : 'кеш'}
                {filteredModels.length !== models.models.length
                  ? `: ${filteredModels.length}/${models.models.length} за запитом`
                  : `: ${models.models.length} шт.`})
              </span>
            )}
            {models?.source === 'fallback' && <span className="lg-hint">(дефолтна — список недоступний)</span>}
          </label>
          {models && models.models.length > 3 && (
            <input
              className="lg-input lg-model-search"
              type="text"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
              placeholder="Пошук моделі: gpt, claude, llama…"
            />
          )}
          {loadingModels ? (
            <div className="lg-hint">Завантаження моделей…</div>
          ) : filteredModels.length === 0 && models && models.models.length > 0 ? (
            <div className="lg-hint">Нічого не знайдено за «{modelSearch}» — спробуйте інший запит або очистіть пошук.</div>
          ) : (
            <select
              className="lg-select"
              value={settings.model}
              onChange={(e) => saveModel(e.target.value)}
              disabled={saving || !filteredModels || filteredModels.length === 0}
              size={filteredModels.length > 0 ? 1 : 1}
            >
              {filteredModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label ? `${m.label} (${m.id})` : m.id}
                </option>
              ))}
              {settings.model && !filteredModels.some((m) => m.id === settings.model) && (
                <option value={settings.model}>{settings.model} (поточна — поза фільтром)</option>
              )}
            </select>
          )}
          <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.75rem' }} onClick={() => loadModels(activeProvider, true)} disabled={loadingModels}>
              ⟳ Оновити список моделей
            </button>
            {modelSearch && (
              <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.75rem' }} onClick={() => setModelSearch('')}>
                ✕ Очистити пошук
              </button>
            )}
          </div>
        </div>
      </div>

      {message && (
        <div className={`lg-alert ${message.kind === 'ok' ? 'lg-alert--ok' : 'lg-alert--error'}`} style={{ marginTop: 12 }}>
          {message.kind === 'ok' ? '✓' : '⚠'} {message.text}
        </div>
      )}
      {models?.error && <div className="lg-alert lg-alert--warn" style={{ marginTop: 12 }}>⚠ {models.error}</div>}
    </div>
  );
}
