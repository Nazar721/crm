'use client';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { project as calcProject, projectStartDate, projectEndDate, projectDaysUsed, getStatsContext } from '@/lib/calc';
import { formatMoney, formatDate, today, daysBetween, getMonthKey, getMonthLabel, itemCurrency } from '@/lib/utils';
import { saveProject, completeProject, deleteProject } from '@/lib/actions';
import { emitToast } from '@/lib/toast-bus';
import type { Project } from '@/types';
import { StatusBadge, TypeBadge, BankBadge } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ProjectForm from '@/components/forms/ProjectForm';
import ConfirmModal from '@/components/ui/ConfirmModal';
import Modal from '@/components/ui/Modal';
import { useConfirm } from '@/hooks/useConfirm';
import { usePersistedState, useScrollRestoration, useVisibleCount } from '@/hooks/useUiState';

type PeriodFilter = '' | 'this_month' | 'last_month' | 'last_30' | 'last_90' | 'this_year' | 'last_year' | `m:${string}`;
type CompletedSort = 'date_desc' | 'date_asc' | 'budget_desc' | 'budget_asc' | 'income_desc' | 'days_asc' | 'days_desc';

const PAGE_SIZE = 60;

export default function ProjectsPage() {
  const { snapshot, triggerRefresh } = useApp();
  const [tab, setTab] = usePersistedState<'active' | 'completed'>('projects:tab', 'active');
  const [search, setSearch] = usePersistedState('projects:search', '');
  const [typeFilter, setTypeFilter] = usePersistedState('projects:type', '');
  const [periodFilter, setPeriodFilter] = usePersistedState<PeriodFilter>('projects:period', '');
  const [specFilter, setSpecFilter] = usePersistedState('projects:spec', '');
  const [clientFilter, setClientFilter] = usePersistedState('projects:client', '');
  const [completedSort, setCompletedSort] = usePersistedState<CompletedSort>('projects:sort', 'date_desc');
  const [formOpen, setFormOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();
  const { count: activeVisible, showMore: showMoreActive, reset: resetActive } = useVisibleCount(PAGE_SIZE);
  const { count: completedVisible, showMore: showMoreCompleted, reset: resetCompleted } = useVisibleCount(PAGE_SIZE);

  const statsCtx = useMemo(() => getStatsContext(snapshot), [snapshot]);
  const specialists = statsCtx.specialists;
  const partners = statsCtx.partners;
  const clients = statsCtx.clients;

  const filterList = useCallback((list: Project[]) => {
    const s = search.toLowerCase();
    return list.filter(p => {
      const client = statsCtx.clientsById.get(p.clientId);
      const clientName = client ? client.name : p.clientName || '';
      return (p.name.toLowerCase().includes(s) || clientName.toLowerCase().includes(s)) && (!typeFilter || p.type === typeFilter);
    });
  }, [search, typeFilter, statsCtx]);

  const active = useMemo(() => {
    const filtered = filterList(statsCtx.active);
    const order: Record<string, number> = { IT: 1, Video: 2, Design: 3 };
    return [...filtered].sort((a, b) => (order[a.type] || 99) - (order[b.type] || 99));
  }, [statsCtx, filterList]);

  // Дата, за якою фільтруємо завершені: фактичне завершення, інакше старт
  const completionDate = useCallback((p: Project) => {
    const d = projectEndDate(p);
    if (d) return d;
    if (p.completedAt) return new Date(p.completedAt).toISOString().split('T')[0];
    return projectStartDate(p);
  }, []);

  const allCompleted = statsCtx.completed;

  // Місяці, у яких реально є завершені проєкти — для селекта
  const monthOptions = useMemo(() => {
    const keys = new Set<string>();
    allCompleted.forEach(p => { const k = getMonthKey(completionDate(p)); if (k) keys.add(k); });
    return [...keys].sort().reverse();
  }, [allCompleted, completionDate]);

  const inPeriod = useCallback((p: Project) => {
    if (!periodFilter) return true;
    const dateStr = completionDate(p);
    if (!dateStr) return false;
    const key = getMonthKey(dateStr);
    if (!key) return false;
    if (periodFilter.startsWith('m:')) return key === periodFilter.slice(2);

    const monthNow = today().slice(0, 7);
    const yearNow = today().slice(0, 4);
    const shiftMonth = (mk: string, delta: number) => {
      const [y, m] = mk.split('-').map(Number);
      const total = y * 12 + (m - 1) + delta;
      return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
    };

    switch (periodFilter) {
      case 'this_month': return key === monthNow;
      case 'last_month': return key === shiftMonth(monthNow, -1);
      case 'last_30': return daysBetween(dateStr, today()) <= 30 && dateStr <= today();
      case 'last_90': return daysBetween(dateStr, today()) <= 90 && dateStr <= today();
      case 'this_year': return key.startsWith(`${yearNow}-`);
      case 'last_year': return key.startsWith(`${Number(yearNow) - 1}-`);
      default: return true;
    }
  }, [periodFilter, completionDate]);

  const completed = useMemo(() => {
    const list = filterList(allCompleted).filter(p =>
      inPeriod(p) &&
      (!specFilter || (specFilter === 'none' ? !p.developerId : p.developerId === specFilter)) &&
      (!clientFilter || p.clientId === clientFilter)
    );
    return [...list].sort((a, b) => {
      switch (completedSort) {
        case 'budget_desc': return (Number(b.budget) || 0) - (Number(a.budget) || 0);
        case 'budget_asc': return (Number(a.budget) || 0) - (Number(b.budget) || 0);
        case 'income_desc': return calcProject(b).myIncome - calcProject(a).myIncome;
        case 'days_asc': return (Number(a.days) || 0) - (Number(b.days) || 0);
        case 'days_desc': return (Number(b.days) || 0) - (Number(a.days) || 0);
        case 'date_asc': return (a.completedAt || 0) - (b.completedAt || 0);
        case 'date_desc':
        default: return (b.completedAt || 0) - (a.completedAt || 0);
      }
    });
  }, [allCompleted, filterList, inPeriod, specFilter, clientFilter, completedSort]);

  // Підсумки по відфільтрованих завершених — по повному набору, не по сторінці
  const completedSummary = useMemo(() => {
    let totalBudget = 0, totalIncome = 0, biggest: Project | null = null, biggestBudget = 0;
    completed.forEach(p => {
      const c = calcProject(p);
      totalBudget += c.budget;
      totalIncome += c.myIncome;
      if (c.budget > biggestBudget) { biggestBudget = c.budget; biggest = p; }
    });
    return {
      count: completed.length,
      totalBudget,
      totalIncome,
      avgCheck: completed.length ? Math.round(totalBudget / completed.length) : 0,
      biggest: biggest as Project | null,
      biggestBudget,
    };
  }, [completed]);

  const resetCompletedFilters = () => {
    setPeriodFilter(''); setSpecFilter(''); setClientFilter(''); setCompletedSort('date_desc'); setTypeFilter(''); setSearch('');
  };

  const hasCompletedFilters = !!(periodFilter || specFilter || clientFilter || typeFilter || search || completedSort !== 'date_desc');

  // Чи можна показати кнопку звіту: є період (місяць) + вибраний фахівець
  const canExportReport = !!(periodFilter && specFilter && specFilter !== 'none' && completed.length > 0);

  const periodTitle = useMemo(() => {
    if (!periodFilter) return 'Увесь час';
    if (periodFilter.startsWith('m:')) return getMonthLabel(periodFilter.slice(2));
    const map: Record<string, string> = {
      this_month: 'Цього місяця',
      last_month: 'Минулого місяця',
      last_30: 'Останні 30 днів',
      last_90: 'Останні 90 днів',
      this_year: 'Цього року',
      last_year: 'Минулого року',
    };
    return map[periodFilter] || periodFilter;
  }, [periodFilter]);

  const reportSpecName = useMemo(() => {
    if (!specFilter || specFilter === 'none') return '';
    return specialists.find(s => s.id === specFilter)?.name || '';
  }, [specFilter, specialists]);

  // Гарно відформатований текстовий звіт для передачі фахівцю (Telegram / копіпаст)
  const reportText = useMemo(() => {
    if (!completed.length) return '';
    const lines: string[] = [];
    lines.push(`📊 Статистика — ${reportSpecName || 'Фахівець'}`);
    lines.push(`🗓 Період: ${periodTitle}`);
    lines.push('');
    let totalSpecPay = 0;
    completed.forEach((p, i) => {
      const c = calcProject(p);
      const cur = itemCurrency(p);
      const specPay = c.specialistCost;
      totalSpecPay += specPay;
      const paid = Number(p.paidToSpecialist) || 0;
      const rest = specPay - paid;
      const status = rest <= 0 ? '✅ виплачено' : `⏳ залишок ${formatMoney(rest, cur)}`;
      lines.push(`${i + 1}. ${p.name}`);
      lines.push(`   📅 ${formatDate(projectStartDate(p))} → ${formatDate(projectEndDate(p))} · ${Number((p as any).days) || '—'} дн.`);
      lines.push(`   💰 Бюджет: ${formatMoney(c.budget, cur)} · Оплата фахівцю: ${formatMoney(specPay, cur)} (${status})`);
    });
    lines.push('');
    lines.push(`———————————`);
    lines.push(`✅ Проєктів: ${completedSummary.count}`);
    lines.push(`💼 Оборот: ${formatMoney(completedSummary.totalBudget)}`);
    lines.push(`💸 Всього фахівцю: ${formatMoney(Math.round(totalSpecPay))}`);
    lines.push(`📈 Середній чек: ${formatMoney(completedSummary.avgCheck)}`);
    return lines.join('\n');
  }, [completed, completedSummary, periodTitle, reportSpecName]);

  const copyReport = async () => {
    if (!reportText) return;
    try {
      await navigator.clipboard.writeText(reportText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = reportText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Тільки ті фахівці/клієнти, які реально є в завершених
  const completedSpecialists = useMemo(() => {
    const ids = new Set(allCompleted.map(p => p.developerId).filter(Boolean));
    return specialists.filter(s => ids.has(s.id));
  }, [allCompleted, specialists]);

  const completedClients = useMemo(() => {
    const ids = new Set(allCompleted.map(p => p.clientId).filter(Boolean));
    return clients.filter(c => ids.has(c.id));
  }, [allCompleted, clients]);

  function deadlineInfo(p: Project) {
    const dd = Number(p.deadlineDays) || 0;
    if (!dd) return { text: '—', color: 'var(--text-secondary)' };
    const used = projectDaysUsed(p, today());
    const left = dd - used;
    // Не «В роботі» — відлік стоїть, показуємо залишок приглушено
    if (p.status !== 'В роботі') {
      if (!p.workedDays) return { text: '—', color: 'var(--text-secondary)' };
      return { text: `${left < 0 ? `${Math.abs(left)} дн. простр.` : `${left} дн.`} (пауза)`, color: 'var(--text-secondary)' };
    }
    if (left === 0) return { text: '0 дн.', color: 'var(--danger)' };
    if (left < 0) return { text: `${Math.abs(left)} дн. простр.`, color: 'var(--danger)' };
    return { text: `${left} дн.`, color: 'var(--accent-green)' };
  }

  const handleSave = async (data: Partial<Project>) => {
    const result = await saveProject(data, editProject?.id);
    if (!result.ok) {
      emitToast(result.errors.map(e => e.message).join('; '), 'error');
      return;
    }
    setFormOpen(false);
    setEditProject(null);
    triggerRefresh();
  };

  const handleComplete = (id: string) => {
    confirm('Завершити проєкт?', 'Проєкт буде перенесено до завершених.', () => {
      void completeProject(id).then(result => {
        if (!result.ok) emitToast(result.errors.map(e => e.message).join('; '), 'error');
        triggerRefresh();
      });
    });
  };

  const handleDelete = (id: string, fromCompleted: boolean) => {
    confirm('Видалити проєкт?', 'Проєкт буде видалений безповоротно.', () => {
      void deleteProject(id, fromCompleted).then(result => {
        if (!result.ok) emitToast(result.errors.map(e => e.message).join('; '), 'error');
        triggerRefresh();
      });
    });
  };

  const visibleActive = active.slice(0, activeVisible);
  const visibleCompleted = completed.slice(0, completedVisible);

  useEffect(() => {
    resetActive();
    resetCompleted();
  }, [search, typeFilter, periodFilter, specFilter, clientFilter, completedSort, resetActive, resetCompleted]);

  useScrollRestoration('projects', true);

  return (
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Проєкти</h1><p className="page-subtitle">Активні та завершені проєкти</p></div>
        <button className="btn btn-primary" onClick={() => { setEditProject(null); setFormOpen(true); }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2"/></svg>
          Новий проєкт
        </button>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'active' ? ' active' : ''}`} onClick={() => setTab('active')}>Активні <span className="tab-count">{active.length}</span></button>
        <button className={`tab${tab === 'completed' ? ' active' : ''}`} onClick={() => setTab('completed')}>Завершені <span className="tab-count">{completed.length}</span></button>
      </div>

      <div className="table-toolbar">
        <div className="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2"/></svg>
          <input type="text" className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук проєктів..." />
        </div>
        <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">Усі типи</option>
          <option value="IT">IT</option>
          <option value="Design">Design</option>
          <option value="Video">Video</option>
        </select>
        {tab === 'completed' && (
          <>
            <select className="filter-select" value={periodFilter} onChange={e => setPeriodFilter(e.target.value as PeriodFilter)}>
              <option value="">Увесь час</option>
              <option value="this_month">Цього місяця</option>
              <option value="last_month">Минулого місяця</option>
              <option value="last_30">Останні 30 днів</option>
              <option value="last_90">Останні 90 днів</option>
              <option value="this_year">Цього року</option>
              <option value="last_year">Минулого року</option>
              {monthOptions.length > 0 && (
                <optgroup label="Конкретний місяць">
                  {monthOptions.map(k => <option key={k} value={`m:${k}`}>{getMonthLabel(k)}</option>)}
                </optgroup>
              )}
            </select>
            <select className="filter-select" value={specFilter} onChange={e => setSpecFilter(e.target.value)}>
              <option value="">Усі фахівці</option>
              {completedSpecialists.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              <option value="none">Без фахівця</option>
            </select>
            <select className="filter-select" value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
              <option value="">Усі клієнти</option>
              {completedClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="filter-select" value={completedSort} onChange={e => setCompletedSort(e.target.value as CompletedSort)}>
              <option value="date_desc">Спочатку нові</option>
              <option value="date_asc">Спочатку старі</option>
              <option value="budget_desc">Найбільший бюджет ↓</option>
              <option value="budget_asc">Найменший бюджет ↑</option>
              <option value="income_desc">Мій дохід ↓</option>
              <option value="days_desc">Найдовші ↓</option>
              <option value="days_asc">Найшвидші ↑</option>
            </select>
            {hasCompletedFilters && (
              <button className="btn btn-ghost" onClick={resetCompletedFilters}>Скинути</button>
            )}
          </>
        )}
      </div>

      {tab === 'active' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Назва</th><th>Тип</th><th>Клієнт</th><th>Старт</th><th>Дедлайн</th><th>Бюджет</th><th>Банк</th><th>Борг клієнта</th><th>Фахівець</th><th>Борг фахівцю</th><th>Прибуток</th><th>ФОП</th><th>Забрав собі</th><th>Лишилось</th><th>Статус</th><th>Дії</th></tr></thead>
            <tbody>
              {!visibleActive.length ? <tr className="empty-row"><td colSpan={16}><EmptyState message="Немає активних проєктів" hint="Натисніть «Новий проєкт», щоб додати" /></td></tr> :
              visibleActive.map(p => {
                const client = statsCtx.clientsById.get(p.clientId);
                const spec = p.developerId ? statsCtx.specialistsById.get(p.developerId) : undefined;
                const c = calcProject(p);
                const dl = deadlineInfo(p);
                return (
                  <tr key={p.id}>
                    <td className="cell-name" data-label="Проєкт"><strong>{p.name}</strong></td>
                    <td data-label="Тип"><TypeBadge type={p.type} /></td>
                    <td data-label="Клієнт">{client?.name || p.clientName || '—'}</td>
                    <td data-label="Старт">{formatDate(projectStartDate(p))}</td>
                    <td data-label="Дедлайн" style={{ color: dl.color }}>{dl.text}</td>
                    <td data-label="Бюджет">{formatMoney(c.budget, itemCurrency(p))}</td>
                    <td data-label="Банк">{p.bank ? <BankBadge bankId={p.bank} /> : <span style={{ color: 'var(--text-secondary)' }}>—</span>}</td>
                    <td data-label="Борг клієнта" style={{ color: 'var(--accent-orange)' }}>{formatMoney(c.clientDebt, itemCurrency(p))}</td>
                    <td data-label="Фахівець" className="cell-nowrap">{spec?.name || '—'}</td>
                    <td data-label="Борг фахівцю" style={{ color: 'var(--accent-orange)' }}>{formatMoney(c.specialistDebt, itemCurrency(p))}</td>
                    <td data-label="Прибуток" style={{ color: 'var(--accent-green)' }}>{formatMoney(c.projectProfit, itemCurrency(p))}</td>
                    <td data-label="ФОП" style={{ color: 'var(--accent-orange)' }}>{formatMoney(c.fopAmount, itemCurrency(p))}</td>
                    <td data-label="Забрав собі" style={{ color: 'var(--accent-blue)' }}>{formatMoney(c.profitTaken, itemCurrency(p))}</td>
                    <td data-label="Лишилось" style={{ color: 'var(--accent-orange)' }}>{formatMoney(c.profitLeft, itemCurrency(p))}</td>
                    <td data-label="Статус"><StatusBadge status={p.status} /></td>
                    <td data-label="Дії">
                      <div className="actions-cell">
                        <button className="btn-icon btn-icon--green" title="Завершити" onClick={() => handleComplete(p.id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></button>
                        <button className="btn-icon" title="Редагувати" onClick={() => { setEditProject(p); setFormOpen(true); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2"/></svg></button>
                        <button className="btn-icon btn-icon--danger" title="Видалити" onClick={() => handleDelete(p.id, false)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/><path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2"/></svg></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {active.length > visibleActive.length && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 14 }}>
              <button className="btn btn-ghost" onClick={showMoreActive}>
                Показати ще {Math.min(PAGE_SIZE, active.length - visibleActive.length)} з {active.length}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'completed' && (
        <>
          <div className="stats-grid stats-grid--wide" style={{ marginBottom: 18 }}>
            <div className="stat-card"><div className="stat-info"><span className="stat-label">Проєктів</span><span className="stat-value">{completedSummary.count}</span></div></div>
            <div className="stat-card"><div className="stat-info"><span className="stat-label">Оборот</span><span className="stat-value">{formatMoney(completedSummary.totalBudget)}</span></div></div>
            <div className="stat-card"><div className="stat-info"><span className="stat-label">Мій дохід</span><span className="stat-value" style={{ color: 'var(--accent-green)' }}>{formatMoney(completedSummary.totalIncome)}</span></div></div>
            <div className="stat-card"><div className="stat-info"><span className="stat-label">Середній чек</span><span className="stat-value">{formatMoney(completedSummary.avgCheck)}</span></div></div>
            <div className="stat-card stat-card--highlight"><div className="stat-info"><span className="stat-label">Найбільший проєкт</span>{completedSummary.biggest && <span className="stat-sublabel">{completedSummary.biggest.name}</span>}<span className="stat-value">{completedSummary.biggest ? formatMoney(completedSummary.biggestBudget) : '—'}</span></div></div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Назва</th><th>Тип</th><th>Клієнт</th><th>Старт</th><th>Завершено</th><th>Днів</th><th>Бюджет</th><th>ФОП</th><th>Фахівець</th><th>Мій дохід</th><th>Дії</th></tr></thead>
              <tbody>
                {!visibleCompleted.length ? <tr className="empty-row"><td colSpan={11}><EmptyState message="Немає завершених проєктів" hint={hasCompletedFilters ? 'Спробуйте змінити фільтри' : undefined} /></td></tr> :
                visibleCompleted.map(p => {
                  const client = statsCtx.clientsById.get(p.clientId);
                  const spec = p.developerId ? statsCtx.specialistsById.get(p.developerId) : undefined;
                  const c = calcProject(p);
                  const isBiggest = completedSummary.biggest?.id === p.id && completed.length > 1;
                  return (
                    <tr key={p.id}>
                      <td data-label="Проєкт"><div className="cell-name-wrap"><strong>{p.name}</strong>{isBiggest && <span className="badge badge--gold" style={{ marginLeft: 6, fontSize: '0.7em', flexShrink: 0 }}>ТОП</span>}</div></td>
                      <td data-label="Тип"><TypeBadge type={p.type} /></td>
                      <td data-label="Клієнт"><div>{client?.name || p.clientName || '—'}</div>{p.clientTelegram && <div className="cell-secondary">{p.clientTelegram}</div>}</td>
                      <td data-label="Старт" className="cell-nowrap">{formatDate(projectStartDate(p))}</td>
                      <td data-label="Завершено" className="cell-nowrap">{formatDate(projectEndDate(p))}</td>
                      <td data-label="Днів" className="cell-nowrap">{(p as any).days ?? '—'} дн.</td>
                      <td data-label="Бюджет" className="cell-money">{formatMoney(c.budget, itemCurrency(p))}</td>
                      <td data-label="ФОП" className="cell-money">{formatMoney(c.fopAmount, itemCurrency(p))}</td>
                      <td data-label="Фахівець"><div className="cell-nowrap">{spec?.name || '—'}</div><div className="cell-secondary cell-nowrap">{formatMoney(c.specialistCost, itemCurrency(p))}</div></td>
                      <td data-label="Мій дохід" className="cell-money" style={{ color: 'var(--accent-green)' }}>{formatMoney(c.myIncome, itemCurrency(p))}</td>
                      <td data-label="Дії">
                        <div className="actions-cell">
                          <button className="btn-icon" title="Редагувати" onClick={() => { setEditProject(p); setFormOpen(true); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2"/></svg></button>
                          <button className="btn-icon btn-icon--danger" title="Видалити" onClick={() => handleDelete(p.id, true)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/><path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2"/></svg></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {completed.length > visibleCompleted.length && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 14 }}>
                <button className="btn btn-ghost" onClick={showMoreCompleted}>
                  Показати ще {Math.min(PAGE_SIZE, completed.length - visibleCompleted.length)} з {completed.length}
                </button>
              </div>
            )}
          </div>
          {canExportReport && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => setReportOpen(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" stroke="currentColor" strokeWidth="2"/><polyline points="7 10 12 15 17 10" stroke="currentColor" strokeWidth="2"/><line x1="12" y1="15" x2="12" y2="3" stroke="currentColor" strokeWidth="2"/></svg>
                Статистика для фахівця · {reportSpecName} · {periodTitle}
              </button>
            </div>
          )}
          {periodFilter && !specFilter && completed.length > 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.8rem', marginTop: 10 }}>
              💡 Оберіть фахівця у фільтрі, щоб зʼявилась кнопка вивантаження статистики для нього
            </p>
          )}
        </>
      )}

      <Modal isOpen={reportOpen} onClose={() => setReportOpen(false)} title={`Статистика · ${reportSpecName} · ${periodTitle}`} size="lg">
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: '0 0 12px' }}>
          Готовий текст для відправки фахівцю в Telegram — скопіюйте або поділіться:
        </p>
        <pre style={{
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 12, padding: 14, fontSize: '0.85rem', lineHeight: 1.55,
          fontFamily: 'inherit', color: 'var(--text-primary)', margin: 0, maxHeight: 380, overflowY: 'auto'
        }}>{reportText}</pre>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={copyReport} style={{ flex: 1, justifyContent: 'center', minWidth: 180 }}>
            {copied ? '✅ Скопійовано!' : '📋 Копіювати текст'}
          </button>
          <a
            className="btn btn-ghost"
            style={{ flex: 1, justifyContent: 'center', minWidth: 180, textDecoration: 'none' }}
            href={`https://t.me/share/url?url=${encodeURIComponent('')}&text=${encodeURIComponent(reportText)}`}
            target="_blank" rel="noopener noreferrer"
          >
            ✈️ Поділитись в Telegram
          </a>
        </div>
      </Modal>

      <ProjectForm isOpen={formOpen} project={editProject} specialists={specialists} partners={partners} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditProject(null); }} />
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
