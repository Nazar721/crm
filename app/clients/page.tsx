'use client';
import { useState, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { clientStats, getStatsContext } from '@/lib/calc';
import { formatMoney } from '@/lib/utils';
import { createClient, updateClient, deleteClient, toggleClientRegular } from '@/lib/actions';
import { emitToast } from '@/lib/toast-bus';
import type { Client } from '@/types';
import { SourceBadge } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ClientForm from '@/components/forms/ClientForm';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/hooks/useConfirm';
import { usePersistedState, useScrollRestoration, useVisibleCount } from '@/hooks/useUiState';

type SortKey = '' | 'budget_desc' | 'profit_desc' | 'projects_desc' | 'debt_desc';
type TypeFilter = '' | 'regular' | 'new';

const PAGE_SIZE = 50;

function reportErrors(errors: { message: string }[]) {
  emitToast(errors.map(e => e.message).join('; '), 'error');
}

export default function ClientsPage() {
  const { snapshot, triggerRefresh } = useApp();
  const [search, setSearch] = usePersistedState('clients:search', '');
  const [sourceFilter, setSourceFilter] = usePersistedState('clients:source', '');
  const [typeFilter, setTypeFilter] = usePersistedState<TypeFilter>('clients:type', '');
  const [sortBy, setSortBy] = usePersistedState<SortKey>('clients:sort', '');
  const [formOpen, setFormOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();
  const { count: visibleCount, showMore, reset: resetVisible } = useVisibleCount(PAGE_SIZE);

  const statsCtx = useMemo(() => getStatsContext(snapshot), [snapshot]);

  const clientsWithStats = useMemo(() => (
    snapshot.clients.map(c => ({ client: c, stats: clientStats(c.id, statsCtx) }))
  ), [snapshot.clients, statsCtx]);

  const filtered = useMemo(() => {
    let result = clientsWithStats;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(({ client: c }) =>
        c.name.toLowerCase().includes(q) || (c.telegram || '').toLowerCase().includes(q)
      );
    }

    if (sourceFilter) {
      result = result.filter(({ client: c }) => c.source === sourceFilter);
    }

    if (typeFilter === 'regular') {
      result = result.filter(({ client: c }) => !!c.isRegular);
    } else if (typeFilter === 'new') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      result = result.filter(({ client: c }) => {
        if (!c.createdAt) return false;
        return new Date(c.createdAt) >= thirtyDaysAgo;
      });
      if (!sortBy) {
        result = [...result].sort((a, b) => {
          const da = a.client.createdAt ? new Date(a.client.createdAt).getTime() : 0;
          const db = b.client.createdAt ? new Date(b.client.createdAt).getTime() : 0;
          return db - da;
        });
      }
    }

    if (sortBy) {
      result = [...result].sort((a, b) => {
        switch (sortBy) {
          case 'budget_desc': return b.stats.totalBudget - a.stats.totalBudget;
          case 'profit_desc': return b.stats.totalProfit - a.stats.totalProfit;
          case 'projects_desc': return b.stats.count - a.stats.count;
          case 'debt_desc': return b.stats.clientDebt - a.stats.clientDebt;
          default: return 0;
        }
      });
    }

    return result;
  }, [clientsWithStats, search, sourceFilter, typeFilter, sortBy]);

  const visible = filtered.slice(0, visibleCount);

  useEffect(() => { resetVisible(); }, [search, sourceFilter, typeFilter, sortBy, resetVisible]);

  const toggleRegular = (id: string) => {
    void toggleClientRegular(id).then(result => {
      if (!result.ok) reportErrors(result.errors);
      triggerRefresh();
    });
  };

  const handleSave = async (data: Partial<Client>) => {
    const result = editClient
      ? await updateClient(editClient.id, data)
      : await createClient(data);
    if (!result.ok) {
      reportErrors(result.errors);
      return;
    }
    setFormOpen(false);
    setEditClient(null);
    triggerRefresh();
  };

  const handleDelete = (id: string) => {
    confirm('Видалити клієнта?', 'Клієнт буде видалений. Проєкти залишаться.', () => {
      void deleteClient(id).then(result => {
        if (!result.ok) reportErrors(result.errors);
        triggerRefresh();
      });
    });
  };

  useScrollRestoration('clients', true);

  return (
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Клієнти</h1><p className="page-subtitle">Статистика рахується з проєктів</p></div>
        <button className="btn btn-primary" onClick={() => { setEditClient(null); setFormOpen(true); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2"/></svg>
          Новий клієнт
        </button>
      </div>
      <div className="table-toolbar">
        <div className="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2"/></svg>
          <input type="text" className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук клієнтів..." />
        </div>
        <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value as TypeFilter)}>
          <option value="">Усі клієнти</option>
          <option value="regular">Постійні</option>
          <option value="new">Нові</option>
        </select>
        <select className="filter-select" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
          <option value="">Усі джерела</option>
          <option value="Telegram">Telegram</option><option value="Instagram">Instagram</option><option value="YouTube">YouTube</option>
          <option value="Реклама">Реклама</option><option value="Сайт">Сайт</option><option value="Сарафанне радіо">Сарафанне радіо</option><option value="Інше">Інше</option>
        </select>
        <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)}>
          <option value="">Сортування: за ім'ям</option>
          <option value="budget_desc">Оборот ↓</option>
          <option value="profit_desc">Прибуток ↓</option>
          <option value="projects_desc">Проєкти ↓</option>
          <option value="debt_desc">Борг ↓</option>
        </select>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Ім'я</th><th>Telegram</th><th>Джерело</th><th>Проєктів</th><th>Оборот</th><th>Прибуток</th><th>Передоплати</th><th>Борг</th><th>Дії</th></tr></thead>
          <tbody>
            {!visible.length ? <tr className="empty-row"><td colSpan={9}><EmptyState message="Немає клієнтів" hint="Клієнти додаються автоматично при створенні проєкту" /></td></tr> :
            visible.map(({ client: c, stats: s }) => (
                <tr key={c.id}>
                  <td data-label="Клієнт">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <strong>{c.name}</strong>
                      <button
                        onClick={() => toggleRegular(c.id)}
                        className={`badge${c.isRegular ? ' badge--green' : ' badge--gray'}`}
                        style={{ fontSize: '0.7em', cursor: 'pointer', border: 'none', padding: '2px 8px' }}
                        title={c.isRegular ? 'Зняти позначку «Постійний»' : 'Позначити як постійного'}
                      >
                        {c.isRegular ? 'Постійний' : 'Не постійний'}
                      </button>
                    </div>
                  </td>
                  <td data-label="Telegram">{c.telegram ? <a href={`https://t.me/${c.telegram.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="link">{c.telegram}</a> : '—'}</td>
                  <td data-label="Джерело"><SourceBadge source={c.source || 'Інше'} /></td>
                  <td data-label="Проєктів">{s.count}</td>
                  <td data-label="Оборот">{formatMoney(s.totalBudget)}</td>
                  <td data-label="Прибуток" style={{ color: 'var(--accent-green)' }}>{formatMoney(s.totalProfit)}</td>
                  <td data-label="Передоплати">{formatMoney(s.totalPrepayment)}</td>
                  <td data-label="Борг" style={{ color: s.clientDebt > 0 ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>{formatMoney(s.clientDebt)}</td>
                  <td data-label="Дії">
                    <div className="actions-cell">
                      <button className="btn-icon btn-icon--edit" title="Редагувати" onClick={() => { setEditClient(c); setFormOpen(true); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2"/></svg></button>
                      <button className="btn-icon btn-icon--danger" title="Видалити" onClick={() => handleDelete(c.id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/><path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2"/></svg></button>
                    </div>
                  </td>
                </tr>
            ))}
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
      <ClientForm isOpen={formOpen} client={editClient} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditClient(null); }} />
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
