'use client';
import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';
import { HOSTING_CURRENCIES } from '@/lib/hosting';
import type { HostingService } from '@/types';

// ============================================================
// Пакет 04: форма картки хостингу (створення/редагування).
// Назва — ручний текст; жодних посилань на проєкти/клієнтів.
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
  const [plan, setPlan] = useState('');
  const [currency, setCurrency] = useState('UAH');
  const [expectedPrice, setExpectedPrice] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setName(service?.name || '');
    setSite(service?.site || '');
    setProvider(service?.provider || '');
    setPlan(service?.plan || '');
    setCurrency(service?.currency || 'UAH');
    setExpectedPrice(service?.expectedPrice !== undefined && service?.expectedPrice !== null ? String(service.expectedPrice) : '');
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
        plan: plan.trim(),
        currency,
        expectedPrice: expectedPrice.trim() === '' ? undefined : Number(expectedPrice),
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
          <input type="text" className="form-input" value={provider} onChange={e => setProvider(e.target.value)} placeholder="Хостер" />
        </div>
        <div className="form-group">
          <label className="form-label">Тариф</label>
          <input type="text" className="form-input" value={plan} onChange={e => setPlan(e.target.value)} placeholder="Business рік" />
        </div>
        <div className="form-group">
          <label className="form-label">Валюта *</label>
          <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
            {HOSTING_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Очікувана ціна продовження</label>
          <input
            type="number"
            className="form-input"
            value={expectedPrice}
            onChange={e => setExpectedPrice(e.target.value)}
            min="0"
            placeholder="1200"
          />
          <small className="form-hint">Оцінка для себе — не факт оплати</small>
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
