'use client';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { getProjects, getCompleted, getClients, getSpecialists, getPartners, getTransactions, saveProjects, saveCompleted, saveTransactions, saveClients } from '@/lib/storage';
import { project as calcProject, projectStartDate, projectEndDate, projectDaysUsed } from '@/lib/calc';
import { formatMoney, formatDate, today, daysBetween, generateId } from '@/lib/utils';
import type { Project } from '@/types';
import { StatusBadge, TypeBadge, BankBadge } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ProjectForm from '@/components/forms/ProjectForm';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/hooks/useConfirm';

export default function ProjectsPage() {
  const { refreshKey, triggerRefresh } = useApp();
  const [tab, setTab] = useState<'active' | 'completed'>('active');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editProject, setEditProject] = useState<Project | null>(null);
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const specialists = useMemo(() => mounted ? getSpecialists() : [], [mounted, refreshKey]);
  const partners = useMemo(() => mounted ? getPartners() : [], [mounted, refreshKey]);
  const clients = useMemo(() => mounted ? getClients() : [], [mounted, refreshKey]);

  const filterList = useCallback((list: Project[]) => {
    const s = search.toLowerCase();
    return list.filter(p => {
      const client = clients.find(c => c.id === p.clientId);
      const clientName = client ? client.name : p.clientName || '';
      return (p.name.toLowerCase().includes(s) || clientName.toLowerCase().includes(s)) && (!typeFilter || p.type === typeFilter);
    });
  }, [search, typeFilter, clients]);

  const active = useMemo(() => {
    if (!mounted) return [];
    const filtered = filterList(getProjects());
    const order: Record<string, number> = { IT: 1, Video: 2, Design: 3 };
    return filtered.sort((a, b) => (order[a.type] || 99) - (order[b.type] || 99));
  }, [mounted, refreshKey, filterList]);

  const completed = useMemo(() => {
    if (!mounted) return [];
    return filterList(getCompleted()).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  }, [mounted, refreshKey, filterList]);

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

  // Відлік дедлайну йде ТІЛЬКИ поки статус «В роботі».
  // Вхід у «В роботі» — ставимо workStartDate; вихід — накопичуємо відпрацьовані дні.
  function resolveDeadlineTracking(next: Partial<Project>, prev?: Project): Pick<Project, 'workStartDate' | 'workedDays'> {
    const wasWorking = prev?.status === 'В роботі';
    const isWorking = next.status === 'В роботі';
    const accumulated = Number(prev?.workedDays) || 0;

    if (isWorking) {
      // Уже був у роботі — не зсуваємо початок поточного відрізка
      if (wasWorking) return { workStartDate: prev?.workStartDate || today(), workedDays: accumulated };
      // Заходимо в роботу — новий відрізок з сьогодні
      return { workStartDate: today(), workedDays: accumulated };
    }

    // Виходимо з роботи — фіксуємо накопичене, зупиняємо відлік
    if (wasWorking) {
      const from = (prev?.workStartDate || '').split('T')[0] || projectStartDate(prev!);
      const segment = from ? Math.max(0, daysBetween(from, today())) : 0;
      return { workStartDate: undefined, workedDays: accumulated + segment };
    }

    return { workStartDate: undefined, workedDays: accumulated };
  }

  const handleSave = (data: Partial<Project>) => {
    if (!data.name) return;

    let clientId = editProject?.clientId || '';
    if (data.clientName) {
      const clients = getClients();
      const nameLower = data.clientName.toLowerCase().trim();
      let existing = clients.find(c => c.name.toLowerCase().trim() === nameLower);
      if (existing) {
        clientId = existing.id;
        const idx = clients.findIndex(c => c.id === existing!.id);
        if (idx >= 0) {
          if (data.clientTelegram && data.clientTelegram !== existing.telegram) clients[idx].telegram = data.clientTelegram;
          if (data.clientSource && data.clientSource !== existing.source) clients[idx].source = data.clientSource;
          saveClients(clients);
        }
      } else {
        const newClient = { id: generateId(), name: data.clientName, telegram: data.clientTelegram || '', source: data.clientSource || 'Інше' };
        clients.push(newClient);
        saveClients(clients);
        clientId = newClient.id;
      }
    }

    const projectData = { ...data, clientId };

    const id = editProject?.id;
    if (id) {
      const list = getProjects();
      const idx = list.findIndex(p => p.id === id);
      if (idx >= 0) {
        list[idx] = { ...list[idx], ...projectData, ...resolveDeadlineTracking(projectData, list[idx]) };
        saveProjects(list);
      }
    } else {
      const list = getProjects();
      list.push({ id: generateId(), createdAt: new Date().toISOString(), ...projectData, ...resolveDeadlineTracking(projectData) } as Project);
      saveProjects(list);
    }
    setFormOpen(false);
    setEditProject(null);
    triggerRefresh();
  };

  const handleComplete = (id: string) => {
    confirm('Завершити проєкт?', 'Проєкт буде перенесено до завершених.', () => {
      const activeList = getProjects();
      const idx = activeList.findIndex(p => p.id === id);
      if (idx < 0) return;
      const p = activeList[idx];
      const finishDate = (p as any).endDate || today();
      const start = projectStartDate(p);
      const days = daysBetween(start, finishDate);
      // Заморожуємо відлік дедлайну на момент завершення
      const frozen = resolveDeadlineTracking({ status: 'Завершено' }, p);
      const completedList = getCompleted();
      completedList.push({ ...p, ...frozen, endDate: finishDate, finishDate, days, completedAt: Date.now() });
      saveCompleted(completedList);
      activeList.splice(idx, 1);
      saveProjects(activeList);
      triggerRefresh();
    });
  };

  const handleDelete = (id: string, fromCompleted: boolean) => {
    confirm('Видалити проєкт?', 'Проєкт буде видалений безповоротно.', () => {
      if (fromCompleted) saveCompleted(getCompleted().filter(p => p.id !== id));
      else saveProjects(getProjects().filter(p => p.id !== id));
      triggerRefresh();
    });
  };

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
      </div>

      {tab === 'active' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Назва</th><th>Тип</th><th>Клієнт</th><th>Старт</th><th>Дедлайн</th><th>Бюджет</th><th>Банк</th><th>Борг клієнта</th><th>Фахівець</th><th>Борг фахівцю</th><th>Прибуток</th><th>ФОП</th><th>Забрав собі</th><th>Лишилось</th><th>Статус</th><th>Дії</th></tr></thead>
            <tbody>
              {!active.length ? <tr className="empty-row"><td colSpan={16}><EmptyState message="Немає активних проєктів" hint="Натисніть «Новий проєкт», щоб додати" /></td></tr> :
              active.map(p => {
                const client = clients.find(c => c.id === p.clientId);
                const spec = specialists.find(s => s.id === p.developerId);
                const c = calcProject(p);
                const dl = deadlineInfo(p);
                return (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td><TypeBadge type={p.type} /></td>
                    <td>{client?.name || p.clientName || '—'}</td>
                    <td>{formatDate(projectStartDate(p))}</td>
                    <td style={{ color: dl.color }}>{dl.text}</td>
                    <td>{formatMoney(c.budget)}</td>
                    <td>{p.bank ? <BankBadge bankId={p.bank} /> : <span style={{ color: 'var(--text-secondary)' }}>—</span>}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>{formatMoney(c.clientDebt)}</td>
                    <td>{spec?.name || '—'}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>{formatMoney(c.specialistDebt)}</td>
                    <td style={{ color: 'var(--accent-green)' }}>{formatMoney(c.projectProfit)}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>{formatMoney(c.fopAmount)}</td>
                    <td style={{ color: 'var(--accent-blue)' }}>{formatMoney(c.profitTaken)}</td>
                    <td style={{ color: 'var(--accent-orange)' }}>{formatMoney(c.profitLeft)}</td>
                    <td><StatusBadge status={p.status} /></td>
                    <td>
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
        </div>
      )}

      {tab === 'completed' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Назва</th><th>Тип</th><th>Клієнт</th><th>Старт</th><th>Завершено</th><th>Днів</th><th>Бюджет</th><th>ФОП</th><th>Фахівець</th><th>Мій дохід</th><th>Дії</th></tr></thead>
            <tbody>
              {!completed.length ? <tr className="empty-row"><td colSpan={11}><EmptyState message="Немає завершених проєктів" /></td></tr> :
              completed.map(p => {
                const client = clients.find(c => c.id === p.clientId);
                const spec = specialists.find(s => s.id === p.developerId);
                const c = calcProject(p);
                return (
                  <tr key={p.id}>
                    <td><strong>{p.name}</strong></td>
                    <td><TypeBadge type={p.type} /></td>
                    <td><div>{client?.name || p.clientName || '—'}</div>{p.clientTelegram && <div style={{ marginTop: 2, color: 'var(--text-secondary)', fontSize: '0.85em' }}>{p.clientTelegram}</div>}</td>
                    <td>{formatDate(projectStartDate(p))}</td>
                    <td>{formatDate(projectEndDate(p))}</td>
                    <td>{(p as any).days ?? '—'} дн.</td>
                    <td>{formatMoney(c.budget)}</td>
                    <td>{formatMoney(c.fopAmount)}</td>
                    <td><div>{spec?.name || '—'}</div><div style={{ marginTop: 2, color: 'var(--text-secondary)' }}>{formatMoney(c.specialistCost)}</div></td>
                    <td style={{ color: 'var(--accent-green)' }}>{formatMoney(c.myIncome)}</td>
                    <td>
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
        </div>
      )}

      <ProjectForm isOpen={formOpen} project={editProject} specialists={specialists} partners={partners} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditProject(null); }} />
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
