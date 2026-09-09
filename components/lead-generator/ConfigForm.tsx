'use client';

import { PipelineConfig } from '@/lib/lead-generator/types';
import { NICHE_SUGGESTIONS, LOCATION_SUGGESTIONS, KEYWORDS_PRESETS } from '@/lib/lead-generator/presets';

export interface RecentConfig {
  niche: string;
  location: string;
  keywords: string;
  additionalCriteria: string;
  usedAt: number;
}

interface Props {
  config: PipelineConfig;
  onChange: (config: PipelineConfig) => void;
  isRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  recents: RecentConfig[];
  onSelectRecent: (recent: RecentConfig) => void;
}

const TOP_NICHES = NICHE_SUGGESTIONS.slice(0, 10);
const TOP_LOCATIONS = ['Kyiv, Ukraine', 'Львів, Україна', 'Одеса, Україна', 'Харків, Україна', 'Дніпро, Україна', 'Warsaw, Poland', 'Berlin, Germany', 'London, UK'];

export default function ConfigForm({
  config,
  onChange,
  isRunning,
  onStart,
  onStop,
  recents,
  onSelectRecent,
}: Props) {
  const set = <K extends keyof PipelineConfig>(key: K, value: PipelineConfig[K]) =>
    onChange({ ...config, [key]: value });

  const applyValue = (field: 'niche' | 'location' | 'keywords', value: string) =>
    set(field, value);

  return (
    <div className="lg-card anim-stagger">
      {recents.length > 0 && (
        <div className="lg-field" style={{ marginBottom: 16 }}>
          <label className="lg-label">Недавні запити</label>
          <div className="lg-chip-row">
            {recents.slice(0, 8).map((recent, i) => (
              <button
                key={`${recent.niche}-${recent.location}-${i}`}
                className="lg-chip lg-chip--clickable"
                onClick={() => onSelectRecent(recent)}
                disabled={isRunning}
                title={`${recent.niche} · ${recent.location}${recent.keywords ? ` · ${recent.keywords}` : ''}`}
              >
                🔍 {recent.niche} · {recent.location}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="lg-grid">
        <div className="lg-field">
          <label className="lg-label">Ніша *</label>
          <input
            className="lg-input"
            type="text"
            list="lg-niche-suggestions"
            value={config.niche}
            onChange={(e) => applyValue('niche', e.target.value)}
            placeholder="почніть вводити — є підказки, напр. стоматологія"
            disabled={isRunning}
          />
          <datalist id="lg-niche-suggestions">
            {NICHE_SUGGESTIONS.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div className="lg-chip-row" style={{ marginTop: 6 }}>
            {TOP_NICHES.map((n) => (
              <button
                key={n}
                className={`lg-chip lg-chip--clickable${config.niche === n ? ' lg-chip--active' : ''}`}
                onClick={() => applyValue('niche', n)}
                disabled={isRunning}
                type="button"
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="lg-field">
          <label className="lg-label">Місто / Країна *</label>
          <input
            className="lg-input"
            type="text"
            list="lg-location-suggestions"
            value={config.location}
            onChange={(e) => applyValue('location', e.target.value)}
            placeholder="почніть вводити — є підказки, напр. Kyiv"
            disabled={isRunning}
          />
          <datalist id="lg-location-suggestions">
            {LOCATION_SUGGESTIONS.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <div className="lg-chip-row" style={{ marginTop: 6 }}>
            {TOP_LOCATIONS.map((l) => (
              <button
                key={l}
                className={`lg-chip lg-chip--clickable${config.location === l ? ' lg-chip--active' : ''}`}
                onClick={() => applyValue('location', l)}
                disabled={isRunning}
                type="button"
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="lg-field">
          <label className="lg-label">Ключові слова</label>
          <input
            className="lg-input"
            type="text"
            list="lg-keywords-suggestions"
            value={config.keywords}
            onChange={(e) => applyValue('keywords', e.target.value)}
            placeholder="через кому: booking, online order"
            disabled={isRunning}
          />
          <datalist id="lg-keywords-suggestions">
            {KEYWORDS_PRESETS.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
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
          <button className="btn btn-primary" onClick={onStart} disabled={!config.niche.trim() || !config.location.trim()}>
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
