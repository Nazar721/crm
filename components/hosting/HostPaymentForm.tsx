'use client';
import { useEffect, useRef, useState } from 'react';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';
import { addCalendarDays, addCalendarMonths, HOSTING_CURRENCIES } from '@/lib/hosting';
import { kyivDateString } from '@/lib/dates';
import { daysBetween, formatDate } from '@/lib/utils';
import { toFiniteNumber } from '@/lib/validate';
import type { HostingCoverage } from '@/lib/hosting';
import type { HostingPayment, HostingService } from '@/types';

// ============================================================
// Пакет 04: форма оплати/продовження хостингу.
// Оплата прив'язується ЛИШЕ до картки хостингу (serviceId);
// жодних транзакцій «Фінансів» і посилань на проєкти.
// Швидкі періоди — календарні місяці/рік (не 30/365 днів): кінець
// обчислюється і показується ДО збереження. Для чинного покриття
// початок пропонується наступним днем після дати закінчення;
// прострочення/прогалина не ховаються — початок можна змінити.
// ============================================================

interface HostPaymentFormProps {
  isOpen: boolean;
  service: HostingService | null;
  payment: HostingPayment | null;
  defaultCurrency?: string;
  /** Стан покриття картки — для пропозиції продовження й попереджень. */
  coverage?: HostingCoverage | null;
  /** Пропонований період (напр. після «ще на рік» від покриття). */
  suggestedPeriod?: { start: string; end: string } | null;
  onSave: (data: Partial<HostingPayment>) => void | Promise<void>;
  onCancel: () => void;
}

const QUICK_PERIODS: { label: string; months: number }[] = [
  { label: '1 місяць', months: 1 },
  { label: '2 місяці', months: 2 },
  { label: '3 місяці', months: 3 },
  { label: '1 рік', months: 12 },
];

/** Орієнтовна сума за тарифом; null — тариф не дозволяє обчислити. */
function estimateAmount(service: HostingService | null, months: number): number | null {
  const price = service ? toFiniteNumber(service.expectedPrice) : null;
  if (price === null || price <= 0) return null;
  if (service!.billingPeriod === 'month') return Math.round(price * months * 100) / 100;
  if (service!.billingPeriod === 'year' && months === 12) return price;
  return null;
}

export default function HostPaymentForm({
  isOpen, service, payment, defaultCurrency, coverage, suggestedPeriod, onSave, onCancel,
}: HostPaymentFormProps) {
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('UAH');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [note, setNote] = useState('');
  const /** null — «Інший період»/ручні дати; число — обраний швидкий період. */
    [quickMonths, setQuickMonths] = useState<number | null>(null);
  const lastSuggestedAmount = useRef('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    lastSuggestedAmount.current = '';
    if (payment) {
      setDate(payment.date || '');
      setAmount(payment.amount !== undefined && payment.amount !== null ? String(payment.amount) : '');
      setCurrency(payment.currency || defaultCurrency || 'UAH');
      setPeriodStart(payment.periodStart || '');
      setPeriodEnd(payment.periodEnd || '');
      setNote(payment.note || '');
      setQuickMonths(null);
    } else {
      // Kyiv-«сьогодні»: UTC-зріз біля півночі Kyiv дав би вчора.
      const today = kyivDateString(new Date()) || new Date().toISOString().slice(0, 10);
      setDate(today);
      setAmount('');
      setCurrency(defaultCurrency || 'UAH');
      // Чинне безперервне покриття → пропозиція продовження з наступного дня;
      // прострочення/прогалина/без оплати → початок «сьогодні», редактовний.
      const continuousEnd = coverage?.coverageEnd && coverage.coverageEnd >= today ? coverage.coverageEnd : null;
      const start = continuousEnd ? addCalendarDays(continuousEnd, 1) : (suggestedPeriod ? suggestedPeriod.start : today);
      setPeriodStart(start);
      setPeriodEnd(suggestedPeriod ? suggestedPeriod.end : '');
      setQuickMonths(null);
      setNote('');
    }
    setSaving(false);
    setError('');
  }, [isOpen, payment, defaultCurrency, coverage, suggestedPeriod]);

  const applyQuickPeriod = (months: number) => {
    if (!periodStart) return;
    const end = addCalendarDays(addCalendarMonths(periodStart, months), -1);
    setPeriodEnd(end);
    setQuickMonths(months);
    const estimate = estimateAmount(service, months);
    if (estimate !== null) {
      const value = String(estimate);
      // Підставляємо орієнтовну суму, але не затираємо власноруч введену.
      if (amount === '' || amount === lastSuggestedAmount.current) {
        lastSuggestedAmount.current = value;
        setAmount(value);
      }
    }
  };

  const pickCustom = () => {
    setQuickMonths(null);
  };

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

  const periodDays = periodStart && periodEnd && periodStart <= periodEnd ? daysBetween(periodStart, periodEnd) + 1 : null;
  const continuationFrom = coverage?.coverageEnd && coverage.coverageEnd >= (kyivDateString(new Date()) || '')
    ? coverage.coverageEnd
    : null;
  const coverageWarning = coverage && !coverage.coverageEnd && coverage.warnings.length ? coverage.warnings[0] : null;

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
      <div className="form-group form-group--full">
        <label className="form-label">Період оплати</label>
        <div className="hosting-quick-periods" role="group" aria-label="Швидкий вибір періоду оплати">
          {QUICK_PERIODS.map(q => (
            <button
              key={q.months}
              type="button"
              className={`btn ${quickMonths === q.months ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => applyQuickPeriod(q.months)}
            >
              {q.label}
            </button>
          ))}
          <button
            type="button"
            className={`btn ${quickMonths === null ? 'btn-primary' : 'btn-ghost'}`}
            onClick={pickCustom}
          >
            Інший період
          </button>
        </div>
        <small className="form-hint">Місяці й рік — календарні: 31.01 + 1 міс = 28.02 (або 29.02)</small>
      </div>
      {periodStart && periodEnd && periodStart <= periodEnd && (
        <div className="hosting-period-summary">
          <strong>Оплачений період: {formatDate(periodStart)} – {formatDate(periodEnd)}</strong>
          <div>
            {quickMonths !== null && `${QUICK_PERIODS.find(q => q.months === quickMonths)?.label} · `}
            {periodDays !== null ? `${periodDays} дн.` : ''}
          </div>
          {continuationFrom && !payment && periodStart === addCalendarDays(continuationFrom, 1) && (
            <div className="hosting-period-summary__note">
              Продовження: поточне покриття до {formatDate(continuationFrom)}, нове — з {formatDate(periodStart)}
            </div>
          )}
        </div>
      )}
      {coverageWarning && (
        <div className="hosting-period-warning" role="alert">
          {coverageWarning}. Початок періоду можна змінити вручну.
        </div>
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
          {estimateAmount(service, 1) !== null && (
            <small className="form-hint">Тариф: {service!.billingPeriod === 'year' ? 'за рік' : 'за місяць'} — можна змінити</small>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Валюта *</label>
          <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
            {HOSTING_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Початок періоду *</label>
          <input
            type="date"
            className="form-input"
            value={periodStart}
            onChange={e => { setPeriodStart(e.target.value); setQuickMonths(null); }}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Кінець періоду *</label>
          <input
            type="date"
            className="form-input"
            value={periodEnd}
            onChange={e => { setPeriodEnd(e.target.value); setQuickMonths(null); }}
          />
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
