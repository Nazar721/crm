'use client';
import { useState, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { getSpecialists, saveSpecialists } from '@/lib/storage';
import { specialistStats } from '@/lib/calc';
import { formatMoney } from '@/lib/utils';
import type { Specialist } from '@/types';
import EmptyStateCard from '@/components/ui/EmptyStateCard';
import SpecialistForm from '@/components/forms/SpecialistForm';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/hooks/useConfirm';

export default function SpecialistsPage() {
  const { refreshKey, triggerRefresh } = useApp();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editSpec, setEditSpec] = useState<Specialist | null>(null);
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const filtered = useMemo(() => {
    if (!mounted) return [];
    return getSpecialists().filter(d => d.name.toLowerCase().includes(search.toLowerCase()) || (d.specialization || '').toLowerCase().includes(search.toLowerCase()));
  }, [mounted, refreshKey, search]);

  const handleSave = (data: { name: string; specialization: string; telegram: string }) => {
    if (!data.name || !data.specialization) return;
    const devs = getSpecialists();
    if (editSpec) {
      const idx = devs.findIndex(d => d.id === editSpec.id);
      if (idx >= 0) devs[idx] = { ...devs[idx], ...data };
    } else {
      devs.push({ id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5), ...data });
    }
    saveSpecialists(devs); setFormOpen(false); setEditSpec(null); triggerRefresh();
  };

  const handleDelete = (id: string) => {
    confirm('Видалити фахівця?', 'Фахівця буде видалено. Проєкти залишаться.', () => {
      saveSpecialists(getSpecialists().filter(d => d.id !== id)); triggerRefresh();
    });
  };

  return (
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Фахівці</h1><p className="page-subtitle">Статистика з завершених проєктів</p></div>
        <button className="btn btn-primary" onClick={() => { setEditSpec(null); setFormOpen(true); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2"/></svg>
          Новий фахівець
        </button>
      </div>
      <div className="table-toolbar">
        <div className="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2"/></svg>
          <input type="text" className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук фахівців..." />
        </div>
      </div>
      <div className="developers-grid">
        {!filtered.length ? <EmptyStateCard icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>} message="Немає фахівців" hint="Натисніть «Новий фахівець», щоб додати" /> :
        filtered.map(d => {
          const s = specialistStats(d.id);
          const initials = d.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
          return (
            <div key={d.id} className="developer-card anim-stagger">
              <div className="dev-card-header">
                <div className="dev-avatar">{initials}</div>
                <div><div className="dev-name">{d.name}</div><div className="dev-spec">{d.specialization || '—'}</div></div>
              </div>
              {d.telegram && <div className="dev-contact">{d.telegram}</div>}
              <div className="dev-stats dev-stats--4">
                <div className="dev-stat"><div className="dev-stat-label">Активних</div><div className="dev-stat-value" style={{ color: s.activeCount > 0 ? 'var(--accent-blue)' : 'var(--text-primary)' }}>{s.activeCount}</div></div>
                <div className="dev-stat"><div className="dev-stat-label">Завершено</div><div className="dev-stat-value">{s.count}</div></div>
                <div className="dev-stat"><div className="dev-stat-label">Виплачено</div><div className="dev-stat-value">{formatMoney(s.totalPaid)}</div></div>
                <div className="dev-stat"><div className="dev-stat-label">Борг</div><div className="dev-stat-value" style={{ color: s.debt > 0 ? 'var(--accent-orange)' : 'var(--accent-green)' }}>{formatMoney(s.debt)}</div></div>
              </div>
              <div className="dev-card-actions">
                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setEditSpec(d); setFormOpen(true); }}>Редагувати</button>
                <button className="btn-icon btn-icon--danger" onClick={() => handleDelete(d.id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/><path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2"/></svg></button>
              </div>
            </div>
          );
        })}
      </div>
      <SpecialistForm isOpen={formOpen} specialist={editSpec} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditSpec(null); }} />
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
