'use client';
import { useState, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useApp } from '@/context/AppContext';
import { formatDate, formatMoney } from '@/lib/utils';
import {
  archiveHostingService, deleteHostingPayment, saveHostingPayment, saveHostingService,
} from '@/lib/actions';
import {
  HOSTING_STATUS_LABELS, filterHostingServices, hostingSummary,
  paymentsOfService, type HostingStatus,
} from '@/lib/hosting';
import { emitToast } from '@/lib/toast-bus';
import Modal from '@/components/ui/Modal';
import ConfirmModal from '@/components/ui/ConfirmModal';
import RowActionButton from '@/components/ui/RowActionButton';
import { useConfirm } from '@/hooks/useConfirm';
import HostServiceForm from '@/components/hosting/HostServiceForm';
import HostPaymentForm from '@/components/hosting/HostPaymentForm';
import type { HostingPayment, HostingService } from '@/types';

// ============================================================
// Пакет 04: сторінка «Хостинг» — ручний облік послуг провайдера.
// Жодних автоматичних транзакцій «Фінансів»; назва послуги — текст
// без карток «Проєктів»/«Клієнтів». Стани — за фактичним покриттям
// оплачених періодів (спільний модуль lib/hosting.ts).
// ============================================================

const HostingRenewalsChart = dynamic(() => import('@/components/charts/HostingRenewalsChart'), {
  ssr: false, loading: () => <div className="hosting-renewal-chart" aria-busy="true" />,
});

const STATUS_BADGE: Record<HostingStatus, string> = {
  no_payment: 'badge--gray',
  paid: 'badge--green',
  ending: 'badge--orange',
  overdue: 'badge--red',
  archived: 'badge--blue',
};

export default function HostingPage() {
  const { triggerRefresh, snapshot } = useApp();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<HostingStatus | ''>('');
  const [providerFilter, setProviderFilter] = useState('');
  const [serviceFormOpen, setServiceFormOpen] = useState(false);
  const [editService, setEditService] = useState<HostingService | null>(null);
  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [paymentService, setPaymentService] = useState<HostingService | null>(null);
  const [editPayment, setEditPayment] = useState<HostingPayment | null>(null);
  const [historyService, setHistoryService] = useState<HostingService | null>(null);
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();

  const services = snapshot.hostingServices;
  const payments = snapshot.hostingPayments;

  const rows = useMemo(
    () => filterHostingServices(services, payments, { query, status: statusFilter || undefined, provider: providerFilter }),
    [services, payments, query, statusFilter, providerFilter],
  );

  const summary = useMemo(() => hostingSummary(services, payments), [services, payments]);

  const providers = useMemo(() => {
    const set = new Set<string>();
    services.forEach(s => { if (s.provider) set.add(s.provider); });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [services]);

  const historyPayments = useMemo(
    () => (historyService ? paymentsOfService(historyService.id, payments) : []),
    [historyService, payments],
  );

  const reportErrors = (errors: { message: string }[]) => {
    emitToast(errors.map(e => e.message).join('; '), 'error');
  };

  const handleServiceSave = async (data: Partial<HostingService>) => {
    const result = await saveHostingService(data, editService?.id);
    if (!result.ok) { reportErrors(result.errors); return; }
    setServiceFormOpen(false);
    setEditService(null);
    triggerRefresh();
  };

  const handleArchive = (service: HostingService) => {
    const next = !service.archived;
    confirm(
      next ? `Архівувати «${service.name}»?` : `Повернути «${service.name}» з архіву?`,
      next
        ? 'Послуга перейде до архіву; оплати збережуться, картку фізично не видалено.'
        : 'Послуга стане активною і знову враховуватиметься в попередженнях.',
      () => {
        void (async () => {
          const result = await archiveHostingService(service.id, next);
          if (!result.ok) { reportErrors(result.errors); return; }
          triggerRefresh();
        })();
      },
    );
  };

  const handlePaymentSave = async (data: Partial<HostingPayment>) => {
    if (!paymentService && !editPayment) return;
    const serviceId = editPayment ? editPayment.serviceId : paymentService!.id;
    const result = await saveHostingPayment({ ...data, serviceId }, editPayment?.id);
    if (!result.ok) { reportErrors(result.errors); return; }
    setPaymentFormOpen(false);
    setPaymentService(null);
    setEditPayment(null);
    triggerRefresh();
  };

  const handleDeletePayment = (payment: HostingPayment) => {
    confirm(
      'Видалити оплату?',
      `Оплату ${formatMoney(payment.amount, payment.currency || 'UAH')} від ${formatDate(payment.date)} буде видалено. Дія потрапить в історію змін і може бути скасована там. Покриття перерахується.`,
      () => {
        void (async () => {
          const result = await deleteHostingPayment(payment.id);
          if (!result.ok) { reportErrors(result.errors); return; }
          triggerRefresh();
        })();
      },
    );
  };

  const openAddService = () => { setEditService(null); setServiceFormOpen(true); };
  const openEditService = (service: HostingService) => { setEditService(service); setServiceFormOpen(true); };
  const openAddPayment = (service: HostingService) => {
    setPaymentService(service);
    setEditPayment(null);
    setPaymentFormOpen(true);
  };
  const openEditPayment = (payment: HostingPayment) => {
    const service = services.find(s => s.id === payment.serviceId) || null;
    setPaymentService(service);
    setEditPayment(payment);
    setPaymentFormOpen(true);
  };

  return (
    <section className="page active">
      <div className="page-header">
        <div>
          <h1 className="page-title">Хостинг</h1>
          <p className="page-subtitle">Облік послуг провайдера: картки та фактичні оплати без автоматичних транзакцій</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={openAddService}>Додати хостинг</button>
        </div>
      </div>

      {/* Підсумки */}
      <div className="hosting-overview">
        <div className="settings-card">
          <div className="settings-info-row"><span>Активні</span><strong>{summary.active}</strong></div>
          <div className="settings-info-row"><span>Без оплати</span><strong>{summary.noPayment}</strong></div>
          <div className="settings-info-row"><span>Закінчуються за 30 днів</span><strong>{summary.endingWithin30}</strong></div>
          <div className="settings-info-row"><span>Прострочені</span><strong>{summary.overdue}</strong></div>
          <div className="settings-info-row"><span>В архіві</span><strong>{summary.archived}</strong></div>
        </div>
        <div className="settings-card">
          <h3 className="settings-title">Коли продовжувати хостинг</h3>
          <HostingRenewalsChart services={services} payments={payments} />
          <p className="settings-text" style={{ fontSize: '0.75rem' }}>
            Кількість послуг за залишком оплачених днів. Без оплати, прострочені й архівні послуги показані в підсумку поруч.
          </p>
        </div>
      </div>

      {/* Пошук і фільтри */}
      <div className="table-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <input
          type="search"
          className="form-input"
          style={{ maxWidth: 260 }}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Пошук: назва, домен, провайдер"
          aria-label="Пошук хостингу"
        />
        <select
          className="form-input"
          style={{ maxWidth: 180 }}
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as HostingStatus | '')}
          aria-label="Фільтр за станом"
        >
          <option value="">Усі стани</option>
          {(Object.keys(HOSTING_STATUS_LABELS) as HostingStatus[]).map(s => (
            <option key={s} value={s}>{HOSTING_STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select
          className="form-input"
          style={{ maxWidth: 200 }}
          value={providerFilter}
          onChange={e => setProviderFilter(e.target.value)}
          aria-label="Фільтр за провайдером"
        >
          <option value="">Усі провайдери</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {rows.length === 0 && (
        <p className="settings-text">
          {services.length === 0
            ? 'Послуг хостингу ще немає. Натисніть «Додати хостинг» — назва вводиться вручну, без прив’язки до проєктів.'
            : 'За обраними фільтрами нічого не знайдено.'}
        </p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Проєкт</th>
                <th>Домен</th>
                <th>Провайдер</th>
                <th>Остання оплата</th>
                <th>Оплачено до</th>
                <th>Днів</th>
                <th>Стан</th>
                <th aria-label="Дії" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ service, coverage }) => (
                <tr key={service.id}>
                  <td data-label="Проєкт" className="cell-name">
                    <strong>{service.name}</strong>
                    {service.plan && <div className="cell-secondary">{service.plan}</div>}
                  </td>
                  <td data-label="Домен">{service.site || '—'}</td>
                  <td data-label="Провайдер">{service.provider || '—'}</td>
                  <td data-label="Остання оплата">
                    {coverage.lastPayment
                      ? `${formatMoney(coverage.lastPayment.amount, coverage.lastPayment.currency || 'UAH')} від ${formatDate(coverage.lastPayment.date)}`
                      : '—'}
                  </td>
                  <td data-label="Оплачено до">{coverage.coverageEnd ? formatDate(coverage.coverageEnd) : '—'}</td>
                  <td data-label="Днів" className="cell-nowrap">
                    {coverage.status === 'archived' ? '—' : coverage.daysLeft !== null ? coverage.daysLeft : '—'}
                  </td>
                  <td data-label="Стан">
                    <span className={`badge ${STATUS_BADGE[coverage.status]}`}>{HOSTING_STATUS_LABELS[coverage.status]}</span>
                    {coverage.warnings.map((w, i) => (
                      <div key={i} style={{ fontSize: '0.7rem', color: 'var(--warning, #b45309)', marginTop: 2 }}>{w}</div>
                    ))}
                  </td>
                  <td data-label="Дії">
                    <div className="text-row-actions">
                      <RowActionButton icon="payment" tone="payment" onClick={() => openAddPayment(service)}>Оплата</RowActionButton>
                      <RowActionButton icon="history" onClick={() => setHistoryService(service)}>Історія</RowActionButton>
                      <RowActionButton icon="edit" tone="edit" onClick={() => openEditService(service)}>Редагувати</RowActionButton>
                      <RowActionButton icon={service.archived ? 'restore' : 'archive'} onClick={() => handleArchive(service)}>
                        {service.archived ? 'Повернути' : 'Архівувати'}
                      </RowActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <HostServiceForm
        isOpen={serviceFormOpen}
        service={editService}
        onSave={handleServiceSave}
        onCancel={() => { setServiceFormOpen(false); setEditService(null); }}
      />
      <HostPaymentForm
        isOpen={paymentFormOpen}
        service={paymentService}
        payment={editPayment}
        defaultCurrency={paymentService?.currency || 'UAH'}
        onSave={handlePaymentSave}
        onCancel={() => { setPaymentFormOpen(false); setPaymentService(null); setEditPayment(null); }}
      />

      {/* Історія оплат */}
      <Modal
        isOpen={!!historyService}
        onClose={() => setHistoryService(null)}
        title={`Історія оплат: ${historyService?.name || ''}`}
        size="lg"
      >
        {historyPayments.length === 0 && <p>Оплат ще немає.</p>}
        {historyPayments.length > 0 && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Сума</th>
                  <th>Період</th>
                  <th>Примітка</th>
                  <th aria-label="Дії" />
                </tr>
              </thead>
              <tbody>
                {[...historyPayments].reverse().map(payment => (
                  <tr key={payment.id}>
                    <td data-label="Дата">{formatDate(payment.date)}</td>
                    <td data-label="Сума">{formatMoney(payment.amount, payment.currency || 'UAH')}</td>
                    <td data-label="Період">{formatDate(payment.periodStart)}–{formatDate(payment.periodEnd)}</td>
                    <td data-label="Примітка">{payment.note || '—'}</td>
                    <td data-label="Дії">
                      <div className="text-row-actions">
                        <RowActionButton icon="edit" tone="edit" onClick={() => { setHistoryService(null); openEditPayment(payment); }}>Редагувати</RowActionButton>
                        <RowActionButton icon="delete" tone="danger" onClick={() => handleDeletePayment(payment)}>Видалити</RowActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="settings-text" style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
          Історія не перезаписується при продовженні — кожна оплата окремий запис. День завершення періоду включно оплачений.
        </p>
      </Modal>

      <ConfirmModal
        isOpen={confirmOpen}
        title={confirmTitle}
        text={confirmText}
        onConfirm={handleConfirm}
        onCancel={cancel}
      />
    </section>
  );
}
