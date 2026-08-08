'use client';
import { useState, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { getPartners, savePartners } from '@/lib/storage';
import { partnerStats } from '@/lib/calc';
import { formatMoney } from '@/lib/utils';
import type { Partner } from '@/types';
import EmptyState from '@/components/ui/EmptyState';
import PartnerForm from '@/components/forms/PartnerForm';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/hooks/useConfirm';

export default function PartnersPage() {
  const { refreshKey, triggerRefresh } = useApp();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editPartner, setEditPartner] = useState<Partner | null>(null);
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const filtered = useMemo(() => {
    if (!mounted) return [];
    return getPartners().filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.services || '').toLowerCase().includes(search.toLowerCase()));
  }, [mounted, refreshKey, search]);

  const handleSave = (data: Partial<Partner>) => {
    if (!data.name) return;
    const partners = getPartners();
    if (editPartner) {
      const idx = partners.findIndex(p => p.id === editPartner.id);
      if (idx >= 0) partners[idx] = { ...partners[idx], ...data };
    } else {
      partners.push({ id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5), ...data } as Partner);
    }
    savePartners(partners); setFormOpen(false); setEditPartner(null); triggerRefresh();
  };

  const handleDelete = (id: string) => {
    confirm('Видалити партнера?', 'Партнер буде видалений.', () => {
      savePartners(getPartners().filter(p => p.id !== id)); triggerRefresh();
    });
  };

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
            {!filtered.length ? <tr className="empty-row"><td colSpan={14}><EmptyState message="Немає партнерів" hint="Додайте партнера або прив'яжіть до проєкту" /></td></tr> :
            filtered.map(p => {
              const s = partnerStats(p.id);
              return (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{p.services || '—'}</td>
                  <td>{s.clientsCount}</td>
                  <td>{formatMoney(s.totalDeals)}</td>
                  <td>{formatMoney(s.totalCommission)}</td>
                  <td>{formatMoney(s.paidToPartner)}</td>
                  <td style={{ color: s.partnerDebt > 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>{formatMoney(s.partnerDebt)}</td>
                  <td style={{ color: 'var(--accent-green)' }}>{formatMoney(s.ourIncome)}</td>
                  <td>{s.givenProjectsCount}</td>
                  <td>{formatMoney(s.givenProjectsPrice)}</td>
                  <td style={{ color: 'var(--accent-green)' }}>{formatMoney(s.ourCommission)}</td>
                  <td>{formatMoney(s.paidToUs)}</td>
                  <td style={{ color: s.theirDebt > 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>{formatMoney(s.theirDebt)}</td>
                  <td>
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
      </div>
      <PartnerForm isOpen={formOpen} partner={editPartner} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditPartner(null); }} />
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
