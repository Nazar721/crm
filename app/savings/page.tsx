'use client';
import { useState, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { getSavings, saveSavings } from '@/lib/storage';
import { savingsSummary, savingsProgress } from '@/lib/calc';
import { formatMoney, formatDate, today } from '@/lib/utils';
import type { Saving } from '@/types';
import { BankBadge } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ProgressBar from '@/components/ui/ProgressBar';
import SavingsChart from '@/components/charts/SavingsChart';
import SavingForm from '@/components/forms/SavingForm';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/hooks/useConfirm';

export default function SavingsPage() {
  const { refreshKey, triggerRefresh } = useApp();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editSaving, setEditSaving] = useState<Saving | null>(null);
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const summary = useMemo(() => mounted ? savingsSummary() : { totalSaved: 0, totalGoal: 0, progress: 0 }, [mounted, refreshKey]);

  const filtered = useMemo(() => {
    if (!mounted) return [];
    return getSavings().filter(s => (s.name || '').toLowerCase().includes(search.toLowerCase())).sort((a, b) => new Date(b.date || '').getTime() - new Date(a.date || '').getTime());
  }, [mounted, refreshKey, search]);

  const chartLabels = filtered.map(s => s.name || 'Ціль');
  const chartSaved = filtered.map(s => Number(s.amount) || 0);
  const chartRemaining = filtered.map(s => Math.max(0, (Number(s.goal) || 0) - (Number(s.amount) || 0)));

  const handleSave = (data: Partial<Saving>) => {
    if (!data.bank || !data.goal) return;
    const savings = getSavings();
    if (editSaving) {
      const idx = savings.findIndex(s => s.id === editSaving.id);
      if (idx >= 0) savings[idx] = { ...savings[idx], ...data };
    } else {
      savings.push({ id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5), ...data } as Saving);
    }
    saveSavings(savings); setFormOpen(false); setEditSaving(null); triggerRefresh();
  };

  const handleDelete = (id: string) => {
    confirm('Видалити відкладення?', 'Запис буде видалено безповоротно.', () => {
      saveSavings(getSavings().filter(s => s.id !== id)); triggerRefresh();
    });
  };

  return (
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Відкладення</h1><p className="page-subtitle">Цілі та накопичення — окремо від проєктів</p></div>
        <button className="btn btn-primary" onClick={() => { setEditSaving(null); setFormOpen(true); }}>+ Відкладення</button>
      </div>
      <div className="finance-summary">
        <div className="stat-card stat-card--highlight"><div className="stat-info"><span className="stat-label">Всього відкладено</span><span className="stat-value">{formatMoney(summary.totalSaved)}</span></div></div>
        <div className="stat-card"><div className="stat-info"><span className="stat-label">Загальна ціль</span><span className="stat-value">{formatMoney(summary.totalGoal)}</span></div></div>
        <div className="stat-card"><div className="stat-info"><span className="stat-label">Загальний прогрес</span><span className="stat-value">{summary.progress}%</span></div></div>
      </div>
      <div className="charts-grid charts-grid--1">
        <div className="chart-card anim-chart"><div className="chart-header"><h3 className="chart-title">Прогрес по цілях</h3></div><SavingsChart labels={chartLabels} saved={chartSaved} remaining={chartRemaining} /></div>
      </div>
      <div className="table-toolbar">
        <div className="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2"/></svg>
          <input type="text" className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук..." />
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Ціль</th><th>Банк</th><th>Наразі</th><th>Ціль</th><th>Прогрес</th><th>Дата</th><th>Дії</th></tr></thead>
          <tbody>
            {!filtered.length ? <tr className="empty-row"><td colSpan={7}><EmptyState message="Немає відкладень" hint="Додайте ціль і суму на рахунку" /></td></tr> :
            filtered.map(s => (
              <tr key={s.id}>
                <td>{s.name || '—'}</td>
                <td><BankBadge bankId={s.bank} /></td>
                <td style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{formatMoney(s.amount)}</td>
                <td>{formatMoney(s.goal)}</td>
                <td><ProgressBar value={savingsProgress(s.amount, s.goal)} /></td>
                <td>{formatDate(s.date)}</td>
                <td>
                  <div className="actions-cell">
                    <button className="btn-icon btn-icon--edit" title="Редагувати" onClick={() => { setEditSaving(s); setFormOpen(true); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2"/></svg></button>
                    <button className="btn-icon btn-icon--danger" title="Видалити" onClick={() => handleDelete(s.id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/><path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2"/></svg></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SavingForm isOpen={formOpen} saving={editSaving} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditSaving(null); }} />
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
