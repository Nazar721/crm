'use client';

import { PipelineConfig } from '@/lib/lead-generator/types';

interface Props {
  config: PipelineConfig;
  onChange: (config: PipelineConfig) => void;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
}

export default function ConfigForm({ config, onChange, isRunning, onStart, onStop }: Props) {
  const set = <K extends keyof PipelineConfig>(key: K, value: PipelineConfig[K]) =>
    onChange({ ...config, [key]: value });

  return (
    <div className="lg-card anim-stagger">
      <div className="lg-grid">
        <div className="lg-field">
          <label className="lg-label">Ніша *</label>
          <input
            className="lg-input"
            type="text"
            value={config.niche}
            onChange={(e) => set('niche', e.target.value)}
            placeholder="напр. dental clinic, restaurant, gym"
            disabled={isRunning}
          />
        </div>
        <div className="lg-field">
          <label className="lg-label">Місто / Країна *</label>
          <input
            className="lg-input"
            type="text"
            value={config.location}
            onChange={(e) => set('location', e.target.value)}
            placeholder="напр. Kyiv, Ukraine"
            disabled={isRunning}
          />
        </div>
        <div className="lg-field">
          <label className="lg-label">Ключові слова</label>
          <input
            className="lg-input"
            type="text"
            value={config.keywords}
            onChange={(e) => set('keywords', e.target.value)}
            placeholder="через кому: booking, online order"
            disabled={isRunning}
          />
        </div>
        <div className="lg-field">
          <label className="lg-label">Макс. результатів: {config.maxResults}</label>
          <input
            className="lg-input"
            type="range"
            min={10}
            max={200}
            step={10}
            value={config.maxResults}
            onChange={(e) => set('maxResults', Number(e.target.value))}
            disabled={isRunning}
          />
        </div>
        <div className="lg-field lg-field--wide">
          <label className="lg-label">Додаткові критерії</label>
          <input
            className="lg-input"
            type="text"
            value={config.additionalCriteria}
            onChange={(e) => set('additionalCriteria', e.target.value)}
            placeholder="напр. без онлайн-запису, застарілий сайт"
            disabled={isRunning}
          />
        </div>
      </div>

      <div className="lg-actions">
        {!isRunning ? (
          <button className="btn btn-primary" onClick={onStart}>
            ▶ Почати пошук
          </button>
        ) : (
          <button className="btn btn-danger" onClick={onStop}>
            ■ Зупинити
          </button>
        )}
        <label className="lg-checkbox" style={{ marginLeft: 'auto' }}>
          <input
            type="checkbox"
            checked={config.useAI}
            onChange={(e) => set('useAI', e.target.checked)}
            disabled={isRunning}
          />
          AI-аналіз
        </label>
        <span className="lg-hint">Провайдер і модель — у вкладці «Налаштування»</span>
      </div>
    </div>
  );
}
