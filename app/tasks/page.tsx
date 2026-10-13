'use client';
import { useMemo, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { formatDate, formatDateTime } from '@/lib/utils';
import { cancelTask, completeTask, saveTask, snoozeTaskReminder } from '@/lib/actions';
import {
  TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, filterTasks, taskCounts,
  type TaskTab,
} from '@/lib/tasks';
import { emitToast } from '@/lib/toast-bus';
import Modal from '@/components/ui/Modal';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/hooks/useConfirm';
import TaskForm from '@/components/tasks/TaskForm';
import type { Task } from '@/types';

// ============================================================
// Пакет 05: сторінка «Завдання» — одноразові завдання з дедлайном
// і нагадуваннями. Виконання завдання не створює фінансових записів.
// ============================================================

const TABS: { id: TaskTab; label: string }[] = [
  { id: 'today', label: 'Сьогодні' },
  { id: 'future', label: 'Майбутні' },
  { id: 'overdue', label: 'Прострочені' },
  { id: 'finished', label: 'Виконані / скасовані' },
];

const PRIORITY_BADGE: Record<string, string> = { high: 'badge--red', normal: 'badge--blue', low: 'badge--gray' };

export default function TasksPage() {
  const { snapshot, triggerRefresh } = useApp();
  const [tab, setTab] = useState<TaskTab>('today');
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState<'' | 'low' | 'normal' | 'high'>('');
  const [formOpen, setFormOpen] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [snoozeTask, setSnoozeTask] = useState<Task | null>(null);
  const [snoozeDate, setSnoozeDate] = useState('');
  const [snoozeTime, setSnoozeTime] = useState('');
  const [snoozeError, setSnoozeError] = useState('');
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();

  const tasks = snapshot.tasks;
  const counts = useMemo(() => taskCounts(tasks), [tasks]);
  const rows = useMemo(
    () => filterTasks(tasks, { tab, query, priority }),
    [tasks, tab, query, priority],
  );

  const reportErrors = (errors: { message: string }[]) => {
    emitToast(errors.map(e => e.message).join('; '), 'error');
  };

  const handleSave = async (data: Record<string, unknown>) => {
    const result = await saveTask(data as never, editTask?.id);
    if (!result.ok) { reportErrors(result.errors); return; }
    setFormOpen(false);
    setEditTask(null);
    triggerRefresh();
  };

  const handleComplete = (task: Task) => {
    confirm(`Виконати «${task.title}»?`, 'Статус зміниться на «Виконано». Фінансові записи не створюються.', () => {
      void (async () => {
        const result = await completeTask(task.id);
        if (!result.ok) { reportErrors(result.errors); return; }
        triggerRefresh();
      })();
    });
  };

  const handleCancel = (task: Task) => {
    confirm(`Скасувати «${task.title}»?`, 'Статус зміниться на «Скасовано»; завдання не нагадуватиме.', () => {
      void (async () => {
        const result = await cancelTask(task.id);
        if (!result.ok) { reportErrors(result.errors); return; }
        triggerRefresh();
      })();
    });
  };

  const openSnooze = (task: Task) => {
    setSnoozeTask(task);
    setSnoozeDate('');
    setSnoozeTime('');
    setSnoozeError('');
  };

  const handleSnooze = async () => {
    if (!snoozeTask) return;
    if (!snoozeDate || !snoozeTime) {
      setSnoozeError('Вкажіть майбутню дату й час нагадування (Kyiv)');
      return;
    }
    const result = await snoozeTaskReminder(snoozeTask.id, snoozeDate, snoozeTime);
    if (!result.ok) {
      setSnoozeError(result.errors.map(e => e.message).join('; '));
      return;
    }
    emitToast('Нагадування перенесено; дедлайн завдання не змінено', 'success');
    setSnoozeTask(null);
    triggerRefresh();
  };

  const openAdd = () => { setEditTask(null); setFormOpen(true); };
  const openEdit = (task: Task) => { setEditTask(task); setFormOpen(true); };

  return (
    <section className="page active">
      <div className="page-header">
        <div>
          <h1 className="page-title">Завдання</h1>
          <p className="page-subtitle">Одноразові завдання та нагадування. Виконання не створює фінансових записів.</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={openAdd}>Додати завдання</button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Стан завдань" style={{ marginBottom: 12 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'overdue' && counts.overdue > 0 ? ` (${counts.overdue})` : ''}
            {t.id === 'today' && counts.today > 0 ? ` (${counts.today})` : ''}
          </button>
        ))}
      </div>

      <div className="table-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <input
          type="search"
          className="form-input"
          style={{ maxWidth: 260 }}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Пошук за назвою та описом"
          aria-label="Пошук завдань"
        />
        <select
          className="form-input"
          style={{ maxWidth: 180 }}
          value={priority}
          onChange={e => setPriority(e.target.value as typeof priority)}
          aria-label="Фільтр за пріоритетом"
        >
          <option value="">Усі пріоритети</option>
          <option value="high">Високий</option>
          <option value="normal">Звичайний</option>
          <option value="low">Низький</option>
        </select>
        {counts.dueReminders > 0 && (
          <span className="badge badge--orange" style={{ alignSelf: 'center' }}>
            Нагадувань зараз: {counts.dueReminders}
          </span>
        )}
      </div>

      {rows.length === 0 && (
        <p className="settings-text">
          {tasks.length === 0 ? 'Завдань ще немає. Натисніть «Додати завдання».' : 'За обраними фільтрами нічого немає.'}
        </p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Завдання</th>
                <th>Дедлайн</th>
                <th>Пріоритет</th>
                <th>Статус</th>
                <th>Нагадування</th>
                <th aria-label="Дії" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ task, schedule }) => (
                <tr key={task.id}>
                  <td data-label="Завдання" className="cell-name">
                    <strong>{task.title}</strong>
                    {task.description && <div className="cell-secondary">{task.description}</div>}
                  </td>
                  <td data-label="Дедлайн" className="cell-nowrap">
                    {task.dueDate
                      ? `${formatDate(task.dueDate)}${task.dueTime ? `, ${task.dueTime}` : ''}${schedule.overdue ? ' ·прострочено' : ''}`
                      : 'без строку'}
                  </td>
                  <td data-label="Пріоритет">
                    <span className={`badge ${PRIORITY_BADGE[task.priority] || 'badge--gray'}`}>{TASK_PRIORITY_LABELS[task.priority]}</span>
                  </td>
                  <td data-label="Статус">{TASK_STATUS_LABELS[task.status]}</td>
                  <td data-label="Нагадування">
                    {task.reminderAt
                      ? `${formatDateTime(task.reminderAt)}${task.reminderShownAt ? ' ·показано' : schedule.reminderDue ? ' ·зараз' : ''}`
                      : '—'}
                  </td>
                  <td data-label="Дії" style={{ whiteSpace: 'nowrap' }}>
                    {task.status === 'planned' && (
                      <>
                        <button className="btn btn-ghost" style={{ padding: '4px 6px', fontSize: '0.75rem' }} onClick={() => handleComplete(task)}>
                          Виконано
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '4px 6px', fontSize: '0.75rem' }} onClick={() => openSnooze(task)}>
                          Нагадати пізніше
                        </button>
                        <button className="btn btn-ghost" style={{ padding: '4px 6px', fontSize: '0.75rem' }} onClick={() => handleCancel(task)}>
                          Скасувати
                        </button>
                      </>
                    )}
                    <button className="btn btn-ghost" style={{ padding: '4px 6px', fontSize: '0.75rem' }} onClick={() => openEdit(task)}>
                      Редагувати
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <TaskForm isOpen={formOpen} task={editTask} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditTask(null); }} />

      <Modal isOpen={!!snoozeTask} onClose={() => setSnoozeTask(null)} title={`Нагадати пізніше: ${snoozeTask?.title || ''}`} size="sm">
        <p style={{ marginTop: 0 }}>
          Оберіть новий момент нагадування (Kyiv). Дедлайн завдання{' '}
          {snoozeTask?.dueDate ? `(${formatDate(snoozeTask.dueDate)})` : '(без строку)'} не зміниться.
        </p>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">Дата</label>
            <input type="date" className="form-input" value={snoozeDate} onChange={e => { setSnoozeDate(e.target.value); setSnoozeError(''); }} />
          </div>
          <div className="form-group">
            <label className="form-label">Час</label>
            <input type="time" className="form-input" value={snoozeTime} onChange={e => { setSnoozeTime(e.target.value); setSnoozeError(''); }} />
          </div>
          {snoozeError && (
            <div className="form-group form-group--full">
              <small style={{ color: 'var(--danger)' }}>{snoozeError}</small>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setSnoozeTask(null)}>Скасувати</button>
          <button className="btn btn-primary" onClick={() => void handleSnooze()}>Перенести нагадування</button>
        </div>
      </Modal>

      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
