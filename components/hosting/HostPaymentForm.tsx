'use client';
import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';
import { HOSTING_CURRENCIES } from '@/lib/hosting';
import { kyivDateString } from '@/lib/dates';
import type { HostingPayment, HostingService } from '@/types';

// ============================================================
// Пакет 04: форма оплати/продовження хостингу.
// Оплата прив'язується ЛИШЕ до картки хостингу (serviceId);
// жодних транзакцій «Фінансів» і посилань на проєкти.
// ============================================================

interface HostPaymentFormProps {
  isOpen: boolean;
  service: HostingService | null;
  payment: HostingPayment | null;
  defaultCurrency?: string;
  /** Пропонований період (напр. після «ще на рік» від покриття). */
  suggestedPeriod?: { start: string; end: string } | null;
  onSave: (data: Partial<HostingPayment>) => void | Promise<void>;
  onCancel: () => void;
}

export default function HostPaymentForm({
  isOpen, service, payment, defaultCurrency, suggestedPeriod, onSave, onCancel,
}: HostPaymentFormProps) {
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('UAH');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    if (payment) {
      setDate(payment.date || '');
      setAmount(payment.amount !== undefined && payment.amount !== null ? String(payment.amount) : '');
      setCurrency(payment.currency || defaultCurrency || 'UAH');
      setPeriodStart(payment.periodStart || '');
      setPeriodEnd(payment.periodEnd || '');
      setNote(payment.note || '');
    } else {
      // Kyiv-«сьогодні»: UTC-зріз біля півночі Kyiv дав би вчора.
      const today = kyivDateString(new Date()) || new Date().toISOString().slice(0, 10);
      setDate(today);
      setAmount('');
      setCurrency(defaultCurrency || 'UAH');
      setPeriodStart(suggestedPeriod ? suggestedPeriod.start : today);
      setPeriodEnd(suggestedPeriod ? suggestedPeriod.end : '');
      setNote('');
    }
    setSaving(false);
    setError('');
  }, [isOpen, payment, defaultCurrency, suggestedPeriod]);

  const handleSave = async () => {
    if (!date || !amount || Number(amount) <= 0 || !periodStart || !periodEnd) {
      setError('Заповніть дату, суму та період (день завершення включно оплачений)');
      return;
    }
    if (periodStart > periodEnd) {
      setError('Кінець періоду не може бути ранішим за початок');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        date,
        amount: Number(amount),
        currency,
        periodStart,
        periodEnd,
        note: note.trim(),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={payment ? 'Редагувати оплату' : `Оплата: ${service?.name || ''}`}
      size="md"
      onSubmit={handleSave}
    >
      {service?.site && (
        <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>{service.site}</p>
      )}
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Дата оплати *</label>
          <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Сума *</label>
          <input
            type="number"
            className="form-input"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            min="0.01"
            step="any"
            placeholder="1200"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Валюта *</label>
          <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
            {HOSTING_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Початок періоду *</label>
          <input type="date" className="form-input" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Кінець періоду *</label>
          <input type="date" className="form-input" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
          <small className="form-hint">День завершення включно оплачений</small>
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Примітка</label>
          <textarea
            className="form-input form-textarea"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Наприклад: продовження на рік, рахунок №123"
          />
          <small className="form-hint">
            Запис є обліком фактичної оплати провайдеру — він не підтверджує продовження автоматично і не створює транзакцій у «Фінансах».
          </small>
        </div>
        {error && (
          <div className="form-group form-group--full">
            <small style={{ color: 'var(--danger)' }}>{error}</small>
          </div>
        )}
      </div>
      <ModalFooter onCancel={onCancel} onSave={() => void handleSave()} disabled={saving} saveLabel={saving ? 'Зберігаю…' : 'Зберегти'} />
    </Modal>
  );
}
