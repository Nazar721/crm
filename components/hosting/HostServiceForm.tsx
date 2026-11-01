'use client';
import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';
import { HOSTING_BILLING_PERIODS, HOSTING_CURRENCIES, isHostingBillingPeriod } from '@/lib/hosting';
import type { HostingBillingPeriod, HostingService } from '@/types';

// ============================================================
// Пакет 04: форма картки хостингу (створення/редагування).
// Назва — ручний текст; жодних посилань на проєкти/клієнтів.
// «Хто оплачує» — окремо від провайдера; тариф — ціна + валюта
// + період («$5 / місяць»), фактична оплата вводиться в формі оплати.
// ============================================================

interface HostServiceFormProps {
  isOpen: boolean;
  service: HostingService | null;
  onSave: (data: Partial<HostingService>) => void | Promise<void>;
  onCancel: () => void;
}

export default function HostServiceForm({ isOpen, service, onSave, onCancel }: HostServiceFormProps) {
  const [name, setName] = useState('');
  const [site, setSite] = useState('');
  const [provider, setProvider] = useState('');
  const [payer, setPayer] = useState('');
  const [plan, setPlan] = useState('');
  const [currency, setCurrency] = useState('UAH');
  const [expectedPrice, setExpectedPrice] = useState('');
  const [billingPeriod, setBillingPeriod] = useState<'' | HostingBillingPeriod>('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName(service?.name || '');
    setSite(service?.site || '');
    setProvider(service?.provider || '');
    setPayer(service?.payer || '');
    setPlan(service?.plan || '');
    setCurrency(service?.currency || 'UAH');
    setExpectedPrice(service?.expectedPrice !== undefined && service?.expectedPrice !== null ? String(service.expectedPrice) : '');
    setBillingPeriod(isHostingBillingPeriod(service?.billingPeriod) ? service.billingPeriod : '');
    setNote(service?.note || '');
    setSaving(false);
    setError('');
  }, [isOpen, service]);

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Вкажіть назву послуги');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        site: site.trim(),
        provider: provider.trim(),
        payer: payer.trim(),
        plan: plan.trim(),
        currency,
        expectedPrice: expectedPrice.trim() === '' ? undefined : Number(expectedPrice),
        billingPeriod: billingPeriod === '' ? undefined : billingPeriod,
        note: note.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={service ? 'Редагувати хостинг' : 'Новий хостинг'} size="md" onSubmit={handleSave}>
      <div className="form-grid">
        <div className="form-group form-group--full">
          <label className="form-label">Назва послуги *</label>
          <input
            type="text"
            className="form-input"
            value={name}
            onChange={e => { setName(e.target.value); setError(''); }}
            placeholder="Наприклад: Квіти"
          />
          {error && <small style={{ color: 'var(--danger)' }}>{error}</small>}
        </div>
        <div className="form-group">
          <label className="form-label">Сайт / домен</label>
          <input type="text" className="form-input" value={site} onChange={e => setSite(e.target.value)} placeholder="kvity.ua" />
        </div>
        <div className="form-group">
          <label className="form-label">Провайдер</label>
          <input type="text" className="form-input" value={provider} onChange={e => setProvider(e.target.value)} placeholder="Vercel, Хостер" />
        </div>
        <div className="form-group">
          <label className="form-label">Хто оплачує</label>
          <input
            type="text"
            className="form-input"
            value={payer}
            onChange={e => setPayer(e.target.value)}
            placeholder="Клієнт або людина, яка платить"
          />
          <small className="form-hint">Окремо від провайдера: напр. Vercel — провайдер, платить — клієнт</small>
        </div>
        <div className="form-group">
          <label className="form-label">Тариф (назва)</label>
          <input type="text" className="form-input" value={plan} onChange={e => setPlan(e.target.value)} placeholder="Business" />
        </div>
        <div className="form-group">
          <label className="form-label">Вартість тарифу</label>
          <input
            type="number"
            className="form-input"
            value={expectedPrice}
            onChange={e => setExpectedPrice(e.target.value)}
            min="0"
            placeholder="225"
          />
          <small className="form-hint">Оцінка; фактична сума вводиться при оплаті</small>
        </div>
        <div className="form-group">
          <label className="form-label">Валюта тарифу *</label>
          <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
            {HOSTING_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Період тарифу</label>
          <select
            className="form-input"
            value={billingPeriod}
            onChange={e => setBillingPeriod(e.target.value as '' | HostingBillingPeriod)}
          >
            <option value="">Не вказано</option>
            {(Object.keys(HOSTING_BILLING_PERIODS) as HostingBillingPeriod[]).map(p => (
              <option key={p} value={p}>{HOSTING_BILLING_PERIODS[p]}</option>
            ))}
          </select>
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Примітка</label>
          <textarea className="form-input form-textarea" value={note} onChange={e => setNote(e.target.value)} placeholder="Деталі тарифу, логін у кабінеті БЕЗ пароля" />
          <small className="form-hint">Паролі та API-ключі провайдера не зберігайте</small>
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={() => void handleSave()} disabled={saving} saveLabel={saving ? 'Зберігаю…' : 'Зберегти'} />
    </Modal>
  );
}
