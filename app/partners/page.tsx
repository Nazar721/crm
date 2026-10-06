'use client';
import { useState, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { partnerStats, getStatsContext } from '@/lib/calc';
import { formatMoney } from '@/lib/utils';
import { savePartner, deletePartner } from '@/lib/actions';
import { emitToast } from '@/lib/toast-bus';
import type { Partner } from '@/types';
import EmptyState from '@/components/ui/EmptyState';
import PartnerForm from '@/components/forms/PartnerForm';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/hooks/useConfirm';
import { usePersistedState, useScrollRestoration, useVisibleCount } from '@/hooks/useUiState';

const PAGE_SIZE = 50;

function reportErrors(errors: { message: string }[]) {
  emitToast(errors.map(e => e.message).join('; '), 'error');
}

export default function PartnersPage() {
  const { snapshot, triggerRefresh } = useApp();
  const [search, setSearch] = usePersistedState('partners:search', '');
  const [formOpen, setFormOpen] = useState(false);
  const [editPartner, setEditPartner] = useState<Partner | null>(null);
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();
  const { count: visibleCount, showMore, reset: resetVisible } = useVisibleCount(PAGE_SIZE);

  const statsCtx = useMemo(() => getStatsContext(snapshot), [snapshot]);

  const filtered = useMemo(() => (
    statsCtx.partners.filter(p =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.services || '').toLowerCase().includes(search.toLowerCase())
    )
  ), [statsCtx, search]);

  const visible = filtered.slice(0, visibleCount);

  useEffect(() => { resetVisible(); }, [search, resetVisible]);

  const handleSave = async (data: Partial<Partner>) => {
    const result = await savePartner(data, editPartner?.id);
    if (!result.ok) {
      reportErrors(result.errors);
      return;
    }
    setFormOpen(false);
    setEditPartner(null);
    triggerRefresh();
  };

  const handleDelete = (id: string) => {
    confirm('Видалити партнера?', 'Партнер буде видалений.', () => {
      void deletePartner(id).then(result => {
        if (!result.ok) reportErrors(result.errors);
        triggerRefresh();
      });
    });
  };

  useScrollRestoration('partners', true);

  return (
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Партнери</h1><p className="page-subtitle">Реферальна система та комісії</p></div>
        <button className="btn btn-primary" onClick={() => { setEditPartner(null); setFormOpen(true); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2"/></svg>
          Новий партнер
        </button>
      </div>
      <div className="table-toolbar">
        <div className="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2"/></svg>
          <input type="text" className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук партнерів..." />
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Назва</th><th>Послуги</th><th>Клієнтів</th><th>Угоди</th><th>Комісія</th><th>Виплачено</th><th>Борг</th><th>Наш дохід</th><th>Передали їм</th><th>Ціна</th><th>Наша комісія</th><th>Виплачено нам</th><th>Їхній борг</th><th>Дії</th></tr></thead>
          <tbody>
            {!visible.length ? <tr className="empty-row"><td colSpan={14}><EmptyState message="Немає партнерів" hint="Додайте партнера або прив'яжіть до проєкту" /></td></tr> :
            visible.map(p => {
              const s = partnerStats(p.id, statsCtx);
              return (
                <tr key={p.id}>
                  <td data-label="Партнер"><strong>{p.name}</strong></td>
                  <td data-label="Послуги">{p.services || '—'}</td>
                  <td data-label="Клієнтів">{s.clientsCount}</td>
                  <td data-label="Угоди">{formatMoney(s.totalDeals)}</td>
                  <td data-label="Комісія">{formatMoney(s.totalCommission)}</td>
                  <td data-label="Виплачено">{formatMoney(s.paidToPartner)}</td>
                  <td data-label="Борг" style={{ color: s.partnerDebt > 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>{formatMoney(s.partnerDebt)}</td>
                  <td data-label="Наш дохід" style={{ color: 'var(--accent-green)' }}>{formatMoney(s.ourIncome)}</td>
                  <td data-label="Передали їм">{s.givenProjectsCount}</td>
                  <td data-label="Ціна">{formatMoney(s.givenProjectsPrice)}</td>
                  <td data-label="Наша комісія" style={{ color: 'var(--accent-green)' }}>{formatMoney(s.ourCommission)}</td>
                  <td data-label="Виплачено нам">{formatMoney(s.paidToUs)}</td>
                  <td data-label="Їхній борг" style={{ color: s.theirDebt > 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>{formatMoney(s.theirDebt)}</td>
                  <td data-label="Дії">
                    <div className="actions-cell">
                      <button className="btn-icon btn-icon--edit" title="Редагувати" onClick={() => { setEditPartner(p); setFormOpen(true); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2"/></svg></button>
                      <button className="btn-icon btn-icon--danger" title="Видалити" onClick={() => handleDelete(p.id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/><path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2"/></svg></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > visible.length && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 14 }}>
            <button className="btn btn-ghost" onClick={showMore}>
              Показати ще {Math.min(PAGE_SIZE, filtered.length - visible.length)} з {filtered.length}
            </button>
          </div>
        )}
      </div>
      <PartnerForm isOpen={formOpen} partner={editPartner} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditPartner(null); }} />
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
