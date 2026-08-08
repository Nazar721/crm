'use client';
import { useState, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { getPersonalDebts, savePersonalDebts } from '@/lib/storage';
import { personalDebtSummary } from '@/lib/calc';
import { formatMoney, formatDate, today } from '@/lib/utils';
import type { PersonalDebt } from '@/types';
import { DebtTypeBadge } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import DebtsChart from '@/components/charts/DebtsChart';
import DebtForm from '@/components/forms/DebtForm';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/hooks/useConfirm';

export default function DebtsPage() {
  const { refreshKey, triggerRefresh } = useApp();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editDebt, setEditDebt] = useState<PersonalDebt | null>(null);
  const [initialType, setInitialType] = useState<'owed_to_me' | 'my_debt'>('owed_to_me');
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const summary = useMemo(() => mounted ? personalDebtSummary() : { owedToMe: 0, myDebts: 0 }, [mounted, refreshKey]);

  const filtered = useMemo(() => {
    if (!mounted) return [];
    return getPersonalDebts().filter(d => {
      const ms = (d.person || '').toLowerCase().includes(search.toLowerCase()) || (d.note || '').toLowerCase().includes(search.toLowerCase());
      const mt = !typeFilter || d.type === typeFilter;
      return ms && mt;
    }).sort((a, b) => new Date(b.date || '').getTime() - new Date(a.date || '').getTime());
  }, [mounted, refreshKey, search, typeFilter]);

  const handleSave = (data: Partial<PersonalDebt>) => {
    if (!data.person || !data.amount) return;
    const debts = getPersonalDebts();
    if (editDebt) {
      const idx = debts.findIndex(d => d.id === editDebt.id);
      if (idx >= 0) debts[idx] = { ...debts[idx], ...data };
    } else {
      debts.push({ id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5), ...data } as PersonalDebt);
    }
    savePersonalDebts(debts); setFormOpen(false); setEditDebt(null); triggerRefresh();
  };

  const handleDelete = (id: string) => {
    confirm('Видалити запис?', 'Запис буде видалено безповоротно.', () => {
      savePersonalDebts(getPersonalDebts().filter(d => d.id !== id)); triggerRefresh();
    });
  };

  return (
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Борги</h1><p className="page-subtitle">Ручний облік — не пов'язано з проєктами</p></div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => { setEditDebt(null); setInitialType('my_debt'); setFormOpen(true); }}>+ Мій борг</button>
          <button className="btn btn-primary" onClick={() => { setEditDebt(null); setInitialType('owed_to_me'); setFormOpen(true); }}>+ Борг мені</button>
        </div>
      </div>
      <div className="finance-summary">
        <div className="stat-card stat-card--warn"><div className="stat-info"><span className="stat-label">Борг мені</span><span className="stat-value">{formatMoney(summary.owedToMe)}</span></div></div>
        <div className="stat-card stat-card--warn"><div className="stat-info"><span className="stat-label">Мої борги</span><span className="stat-value">{formatMoney(summary.myDebts)}</span></div></div>
      </div>
      <div className="charts-grid charts-grid--1">
        <div className="chart-card anim-chart"><div className="chart-header"><h3 className="chart-title">Борг мені / Мої борги</h3></div><DebtsChart owedToMe={summary.owedToMe} myDebts={summary.myDebts} /></div>
      </div>
      <div className="table-toolbar">
        <div className="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2"/></svg>
          <input type="text" className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук..." />
        </div>
        <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">Усі типи</option><option value="owed_to_me">Борг мені</option><option value="my_debt">Мій борг</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Тип</th><th>Хто / Кому</th><th>Сума</th><th>Примітка</th><th>Дата</th><th>Дії</th></tr></thead>
          <tbody>
            {!filtered.length ? <tr className="empty-row"><td colSpan={6}><EmptyState message="Немає записів" hint="Додайте борг мені або свій борг" /></td></tr> :
            filtered.map(d => (
              <tr key={d.id}>
                <td><DebtTypeBadge type={d.type} /></td>
                <td>{d.person || '—'}</td>
                <td style={{ color: d.type === 'owed_to_me' ? 'var(--accent-green)' : 'var(--accent-orange)', fontWeight: 600 }}>{formatMoney(d.amount)}</td>
                <td>{d.note || '—'}</td>
                <td>{formatDate(d.date)}</td>
                <td>
                  <div className="actions-cell">
                    <button className="btn-icon btn-icon--edit" title="Редагувати" onClick={() => { setEditDebt(d); setFormOpen(true); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2"/></svg></button>
                    <button className="btn-icon btn-icon--danger" title="Видалити" onClick={() => handleDelete(d.id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/><path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2"/></svg></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DebtForm isOpen={formOpen} debt={editDebt} initialType={initialType} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditDebt(null); }} />
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
