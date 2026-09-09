'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

interface ProviderMeta {
  id: string;
  label: string;
  keyHint: string;
  defaultModel: string;
  isCustom?: boolean;
  customId?: string | null;
}

interface KeyStatus {
  masked: string;
  hasKey: boolean;
  fromEnv: boolean;
}

interface CustomProviderInfo {
  id: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  maskedKey: string;
  hasKey: boolean;
  settingId: string;
}

interface SettingsResponse {
  provider: string;
  model: string;
  providers: ProviderMeta[];
  keys: Record<string, KeyStatus>;
  customs: CustomProviderInfo[];
}

interface ModelsResponse {
  provider: string;
  hasApiKey: boolean;
  models: { id: string; label?: string }[];
  defaultModel: string;
  source: 'live' | 'cache' | 'fallback';
  error?: string;
  maskedApiKey?: string;
}

export default function SettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [customFormOpen, setCustomFormOpen] = useState(false);
  const [customForm, setCustomForm] = useState({ label: '', baseUrl: '', apiKey: '', defaultModel: '' });

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
  const activeCustom = settings?.customs.find((c) => c.settingId === activeProvider);
  const activeKey = activeCustom
    ? { masked: activeCustom.maskedKey, hasKey: activeCustom.hasKey, fromEnv: false }
    : settings?.keys[activeProvider];

  const filteredModels = useMemo(() => {
    const list = models?.models ?? [];
    const query = modelSearch.trim().toLowerCase();
    if (!query) return list;
    return list.filter(
      (m) => m.id.toLowerCase().includes(query) || (m.label || '').toLowerCase().includes(query)
    );
  }, [models, modelSearch]);

  const loadModels = useCallback(
    async (provider: string, refresh = false) => {
      setLoadingModels(true);
      setModels(null);
      setModelSearch('');
      try {
        const res = await fetch(`/api/lead-generator/models?provider=${encodeURIComponent(provider)}${refresh ? '&refresh=1' : ''}`);
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

  const switchProvider = async (provider: string) => {
    setSelectedProvider(provider);
    const meta = settings?.providers.find((p) => p.id === provider);
    if (meta) await save({ provider, model: meta.defaultModel || undefined }, `Провайдер: ${meta.label}`);
    loadModels(provider);
  };

  const saveCustomProvider = async () => {
    if (!customForm.label.trim() || !customForm.baseUrl.trim()) {
      setMessage({ kind: 'err', text: 'Заповніть назву та Base URL' });
      return;
    }
    await save(
      { customProvider: customForm },
      `Провайдер «${customForm.label}» збережено`
    );
    setCustomForm({ label: '', baseUrl: '', apiKey: '', defaultModel: '' });
    setCustomFormOpen(false);
  };

  const deleteCustom = async (customId: string) => {
    await save({ deleteCustomId: customId }, 'Кастомного провайдера видалено');
  };

  if (!settings) return <div className="lg-hint">Завантаження налаштувань…</div>;

  return (
    <div className="lg-settings-panel">
      <div className="lg-field">
        <label className="lg-label">AI-провайдер</label>
        <div className="lg-chip-row">
          {settings.providers.map((p) => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <button
                className={`lg-provider-chip${p.id === activeProvider ? ' lg-provider-chip--active' : ''}${(p.isCustom ? settings.customs.find((c) => c.settingId === p.id)?.hasKey : settings.keys[p.id]?.hasKey) ? ' lg-provider-chip--haskey' : ''}`}
                onClick={() => switchProvider(p.id)}
                disabled={saving}
                title={p.isCustom ? `Кастомний: ${p.id}` : settings.keys[p.id]?.hasKey ? 'Ключ налаштований' : 'Без ключа'}
              >
                {p.label}
                {p.isCustom
                  ? settings.customs.find((c) => c.settingId === p.id)?.hasKey && <span className="lg-provider-dot" />
                  : settings.keys[p.id]?.hasKey && <span className="lg-provider-dot" />}
              </button>
              {p.isCustom && p.customId && (
                <button
                  className="lg-copy-btn"
                  title="Видалити кастомного провайдера"
                  onClick={() => deleteCustom(p.customId!)}
                  disabled={saving}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          <button
            className={`lg-provider-chip${customFormOpen ? ' lg-provider-chip--active' : ''}`}
            onClick={() => setCustomFormOpen(!customFormOpen)}
            disabled={saving}
            title="Додати власний OpenAI-сумісний провайдер"
          >
            + Кастомний
          </button>
        </div>
      </div>

      {customFormOpen && (
        <div className="lg-card lg-custom-form">
          <h3 className="lg-section-title">Новий кастомний провайдер (OpenAI-сумісний API)</h3>
          <div className="lg-settings-grid">
            <div className="lg-field">
              <label className="lg-label">Назва *</label>
              <input
                className="lg-input"
                type="text"
                value={customForm.label}
                onChange={(e) => setCustomForm({ ...customForm, label: e.target.value })}
                placeholder="напр. Ollama Local, Together AI, OpenAI-проксі"
              />
            </div>
            <div className="lg-field">
              <label className="lg-label">Base URL *</label>
              <input
                className="lg-input"
                type="text"
                value={customForm.baseUrl}
                onChange={(e) => setCustomForm({ ...customForm, baseUrl: e.target.value })}
                placeholder="напр. http://localhost:11434/v1"
              />
            </div>
            <div className="lg-field">
              <label className="lg-label">API-ключ (опційно)</label>
              <input
                className="lg-input"
                type="password"
                value={customForm.apiKey}
                onChange={(e) => setCustomForm({ ...customForm, apiKey: e.target.value })}
                placeholder="залиште порожнім для локальних серверів (Ollama)"
                autoComplete="off"
              />
            </div>
            <div className="lg-field">
              <label className="lg-label">Модель за замовчуванням</label>
              <input
                className="lg-input"
                type="text"
                value={customForm.defaultModel}
                onChange={(e) => setCustomForm({ ...customForm, defaultModel: e.target.value })}
                placeholder="напр. llama3.1 — список моделей підтягнеться після збереження"
              />
            </div>
          </div>
          <div className="lg-actions" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={saveCustomProvider} disabled={saving}>
              Зберегти провайдера
            </button>
            <button className="btn btn-ghost" onClick={() => setCustomFormOpen(false)} disabled={saving}>
              Скасувати
            </button>
            <span className="lg-hint">Підходить будь-який API з /chat/completions: Ollama, LM Studio, vLLM, Together, DeepSeek…</span>
          </div>
        </div>
      )}

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
            Ключі зберігаються локально в БД Lead Generator.
            {activeMeta && !activeMeta.isCustom && (
              <> Для {activeMeta.label} можна також задати env-змінну <code>{String(activeMeta.id).toUpperCase()}_API_KEY</code>.</>
            )}
            {activeCustom && <> Кастомний провайдер: <code>{activeCustom.baseUrl}</code></>}
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
