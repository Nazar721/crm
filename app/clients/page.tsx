'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '@/context/AppContext';
import { getClients, saveClients } from '@/lib/storage';
import { clientStats } from '@/lib/calc';
import { formatMoney } from '@/lib/utils';
import type { Client } from '@/types';
import { SourceBadge } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ClientForm from '@/components/forms/ClientForm';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/hooks/useConfirm';

export default function ClientsPage() {
  const { refreshKey, triggerRefresh } = useApp();
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const filtered = useMemo(() => {
    if (!mounted) return [];
    return getClients().filter(c => {
      const ms = c.name.toLowerCase().includes(search.toLowerCase()) || (c.telegram || '').toLowerCase().includes(search.toLowerCase());
      const mf = !sourceFilter || c.source === sourceFilter;
      return ms && mf;
    });
  }, [mounted, refreshKey, search, sourceFilter]);

  const handleSave = (data: Partial<Client>) => {
    if (!editClient) return;
    const clients = getClients();
    const idx = clients.findIndex(c => c.id === editClient.id);
    if (idx >= 0) { clients[idx] = { ...clients[idx], ...data }; saveClients(clients); }
    setFormOpen(false); setEditClient(null); triggerRefresh();
  };

  const handleDelete = (id: string) => {
    confirm('Видалити клієнта?', 'Клієнт буде видалений. Проєкти залишаться.', () => {
      saveClients(getClients().filter(c => c.id !== id)); triggerRefresh();
    });
  };

  return (
    <section className="page active">
      <div className="page-header"><div><h1 className="page-title">Клієнти</h1><p className="page-subtitle">Статистика рахується з проєктів</p></div></div>
      <div className="table-toolbar">
        <div className="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2"/></svg>
          <input type="text" className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук клієнтів..." />
        </div>
        <select className="filter-select" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
          <option value="">Усі джерела</option>
          <option value="Telegram">Telegram</option><option value="Instagram">Instagram</option><option value="YouTube">YouTube</option>
          <option value="Реклама">Реклама</option><option value="Сайт">Сайт</option><option value="Сарафанне радіо">Сарафанне радіо</option><option value="Інше">Інше</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Ім'я</th><th>Telegram</th><th>Джерело</th><th>Проєктів</th><th>Оборот</th><th>Прибуток</th><th>Передоплати</th><th>Борг</th><th>Дії</th></tr></thead>
          <tbody>
            {!filtered.length ? <tr className="empty-row"><td colSpan={9}><EmptyState message="Немає клієнтів" hint="Клієнти додаються автоматично при створенні проєкту" /></td></tr> :
            filtered.map((c, i) => {
              const s = clientStats(c.id);
              return (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong>{c.isRegular ? <span className="badge badge--green" style={{ fontSize: '0.7em', marginLeft: 4 }}>Постійний</span> : null}</td>
                  <td>{c.telegram ? <a href={`https://t.me/${c.telegram.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="link">{c.telegram}</a> : '—'}</td>
                  <td><SourceBadge source={c.source || 'Інше'} /></td>
                  <td>{s.count}</td>
                  <td>{formatMoney(s.totalBudget)}</td>
                  <td style={{ color: 'var(--accent-green)' }}>{formatMoney(s.totalProfit)}</td>
                  <td>{formatMoney(s.totalPrepayment)}</td>
                  <td style={{ color: s.clientDebt > 0 ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>{formatMoney(s.clientDebt)}</td>
                  <td>
                    <div className="actions-cell">
                      <button className="btn-icon btn-icon--edit" title="Редагувати" onClick={() => { setEditClient(c); setFormOpen(true); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2"/></svg></button>
                      <button className="btn-icon btn-icon--danger" title="Видалити" onClick={() => handleDelete(c.id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/><path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2"/></svg></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ClientForm isOpen={formOpen} client={editClient} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditClient(null); }} />
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
