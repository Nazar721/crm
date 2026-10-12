'use client';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { saveRates, setDisplayCurrency } from '@/lib/actions';
import { emitToast } from '@/lib/toast-bus';
import {
  syncRatesDraft,
  isRatesDraftDirty,
  CLEAN_RATES_DIRTY,
  type RatesDirty,
} from '@/lib/settings-tabs';

/**
 * Вкладка «Фінанси»: валюта відображення + курси.
 * Використовує ТІ САМІ доменні дії, що й сторінка Фінанси
 * (`setDisplayCurrency`, `saveRates`) — другого сховища немає.
 * displayCurrency при збереженні курсів не скидається
 * (гарантія `_saveRates`: чинне значення зберігається).
 *
 * P2: чернетка курсів живе на рівні секції й syncRatesDraft НЕ затирає
 * поля, які користувач уже редагує. Перемикання вкладок тепер не
 * розмонтовує секцію (сторінка тримає всі секції змонтованими), тож
 * незбережений ввід не губиться мовчки.
 */
export default function FinanceSettingsSection({ onChanged }: { onChanged: () => void }) {
  const { snapshot, triggerRefresh } = useApp();
  const [displayCurrency, setDisplayCurrencyValue] = useState('UAH');
  const [usdRate, setUsdRate] = useState('');
  const [eurRate, setEurRate] = useState('');
  const [usdtRate, setUsdtRate] = useState('');
  const [ratesDirty, setRatesDirty] = useState<RatesDirty>({ ...CLEAN_RATES_DIRTY });
  const [saving, setSaving] = useState(false);
  const lastSyncedRates = useRef('');

  const financeSettings = snapshot.financeSettings;

  // Підтягуємо актуальні курси лише в чисті поля; брудні (редаговані)
  // лишаємо як є — effect на весь snapshot більше не стирає ввід,
  // коли поруч змінюється displayCurrency.
  useEffect(() => {
    const next = syncRatesDraft({ usdRate, eurRate, usdtRate }, financeSettings, ratesDirty);
    const key = `${financeSettings.usdRate}|${financeSettings.eurRate}|${financeSettings.usdtRate ?? ''}`;
    if (key === lastSyncedRates.current) return;
    lastSyncedRates.current = key;
    if (!ratesDirty.usd) setUsdRate(next.usdRate);
    if (!ratesDirty.eur) setEurRate(next.eurRate);
    if (!ratesDirty.usdt) setUsdtRate(next.usdtRate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financeSettings]);

  useEffect(() => {
    setDisplayCurrencyValue(financeSettings.displayCurrency || 'UAH');
  }, [financeSettings.displayCurrency]);

  const markRateDirty = (field: keyof RatesDirty, value: string, set: (v: string) => void) => {
    set(value);
    setRatesDirty(prev => (prev[field] ? prev : { ...prev, [field]: true }));
  };

  const ratesUnsaved = isRatesDraftDirty({ usdRate, eurRate, usdtRate }, financeSettings);

  const changeDisplayCurrency = async (cur: string) => {
    const result = await setDisplayCurrency(cur as 'UAH' | 'USD' | 'EUR');
    if (!result.ok) {
      emitToast(result.errors.map(e => e.message).join('; '), 'error');
      return;
    }
    setDisplayCurrencyValue(cur);
    triggerRefresh();
    onChanged();
  };

  const handleSaveRates = async () => {
    setSaving(true);
    try {
      const result = await saveRates({ usdRate, eurRate, usdtRate });
      if (!result.ok) {
        emitToast(result.errors.map(e => e.message).join('; '), 'error');
        return;
      }
      emitToast('Курси збережено', 'success');
      setRatesDirty({ ...CLEAN_RATES_DIRTY });
      triggerRefresh();
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-grid">
      <div className="settings-card">
        <h3 className="settings-title">Валюта відображення</h3>
        <p className="settings-text">Усі суми в CRM відображатимуться у вибраній валюті.</p>
        <div style={{ marginTop: 12 }}>
          <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>Показувати все в:</label>
          <select className="form-input" style={{ maxWidth: 220 }} value={displayCurrency} onChange={e => changeDisplayCurrency(e.target.value)}>
            <option value="UAH">₴ Гривня (UAH)</option>
            <option value="USD">$ Долар (USD)</option>
            <option value="EUR">€ Євро (EUR)</option>
          </select>
        </div>
        <div style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          <span>Поточні курси: </span>
          <strong>1$ = {snapshot.financeSettings.usdRate}₴</strong> · <strong>1€ = {snapshot.financeSettings.eurRate}₴</strong> · <strong>1 USDT = {snapshot.financeSettings.usdtRate ?? snapshot.financeSettings.usdRate}₴</strong>
          <span style={{ marginLeft: 8 }}>(ті самі, що на сторінці Фінанси)</span>
        </div>
      </div>

      <div className="settings-card">
        <h3 className="settings-title">Курси валют</h3>
        <p className="settings-text">Той самий запис, що й редактор курсів на сторінці Фінанси. Зміна курсів перераховує баланси, графіки й відображення.</p>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <div className="form-group">
            <label className="form-label">USD → UAH</label>
            <input className="form-input" inputMode="decimal" type="number" min="0" step="0.01" value={usdRate} onChange={e => markRateDirty('usd', e.target.value, setUsdRate)} />
          </div>
          <div className="form-group">
            <label className="form-label">EUR → UAH</label>
            <input className="form-input" inputMode="decimal" type="number" min="0" step="0.01" value={eurRate} onChange={e => markRateDirty('eur', e.target.value, setEurRate)} />
          </div>
          <div className="form-group">
            <label className="form-label">USDT → UAH</label>
            <input className="form-input" inputMode="decimal" type="number" min="0" step="0.01" value={usdtRate} onChange={e => markRateDirty('usdt', e.target.value, setUsdtRate)} />
          </div>
        </div>
        <div className="header-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={handleSaveRates} disabled={saving}>{saving ? 'Зберігаю…' : 'Зберегти курси'}</button>
          {ratesUnsaved && !saving && (
            <span style={{ color: 'var(--accent-orange)', fontSize: '0.82rem' }}>Є незбережені зміни курсів</span>
          )}
        </div>
      </div>
    </div>
  );
}
