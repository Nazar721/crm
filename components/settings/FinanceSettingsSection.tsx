'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { saveRates, setDisplayCurrency } from '@/lib/actions';
import { emitToast } from '@/lib/toast-bus';

/**
 * Вкладка «Фінанси»: валюта відображення + курси.
 * Використовує ТІ САМІ доменні дії, що й сторінка Фінанси
 * (`setDisplayCurrency`, `saveRates`) — другого сховища немає.
 * displayCurrency при збереженні курсів не скидається
 * (гарантія `_saveRates`: чинне значення зберігається).
 */
export default function FinanceSettingsSection({ onChanged }: { onChanged: () => void }) {
  const { snapshot, triggerRefresh } = useApp();
  const [displayCurrency, setDisplayCurrencyValue] = useState('UAH');
  const [usdRate, setUsdRate] = useState('');
  const [eurRate, setEurRate] = useState('');
  const [usdtRate, setUsdtRate] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayCurrencyValue(snapshot.financeSettings.displayCurrency || 'UAH');
    setUsdRate(String(snapshot.financeSettings.usdRate));
    setEurRate(String(snapshot.financeSettings.eurRate));
    setUsdtRate(String(snapshot.financeSettings.usdtRate ?? snapshot.financeSettings.usdRate));
  }, [snapshot.financeSettings]);

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
            <input className="form-input" inputMode="decimal" type="number" min="0" step="0.01" value={usdRate} onChange={e => setUsdRate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">EUR → UAH</label>
            <input className="form-input" inputMode="decimal" type="number" min="0" step="0.01" value={eurRate} onChange={e => setEurRate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">USDT → UAH</label>
            <input className="form-input" inputMode="decimal" type="number" min="0" step="0.01" value={usdtRate} onChange={e => setUsdtRate(e.target.value)} />
          </div>
        </div>
        <div className="header-actions" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" onClick={handleSaveRates} disabled={saving}>{saving ? 'Зберігаю…' : 'Зберегти курси'}</button>
        </div>
      </div>
    </div>
  );
}
