'use client';
import { useEffect, useState } from 'react';
import Modal from '@/components/ui/Modal';
import { formatDateTime } from '@/lib/utils';
import ModalFooter from '@/components/ui/ModalFooter';
import { TASK_PRIORITIES, TASK_STATUSES, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from '@/lib/tasks';
import type { Task } from '@/types';

// ============================================================
// Пакет 05: форма завдання (створення/редагування).
// Дедлайн і нагадування — різні поля; нагадування виникає лише за
// явної дати й часу; виконання не створює фінансових записів.
// ============================================================

interface TaskFormProps {
  isOpen: boolean;
  task: Task | null;
  onSave: (data: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}

export default function TaskForm({ isOpen, task, onSave, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [status, setStatus] = useState('planned');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [reminderDate, setReminderDate] = useState('');
  const [reminderTime, setReminderTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reminderClear, setReminderClear] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setTitle(task?.title || '');
    setDescription(task?.description || '');
    setPriority(task?.priority || 'normal');
    setStatus(task?.status || 'planned');
    setDueDate(task?.dueDate || '');
    setDueTime(task?.dueTime || '');
    // Наявне нагадування показуємо як календарні значення Kyiv (після повторного
    // відкриття момент відображається через локальний перерахунок нижче).
    setReminderDate('');
    setReminderTime('');
    setReminderClear(false);
    setSaving(false);
    setError('');
  }, [isOpen, task]);

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Вкажіть назву завдання');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        title: title.trim(),
        description: description.trim(),
        priority,
        status,
        dueDate,
        dueTime: dueDate && dueTime ? dueTime : '',
        // Нагадування змінюється лише явно: обидві поля або явне прибирання.
        ...(reminderDate && reminderTime ? { reminderDate, reminderTime } : {}),
        ...(reminderClear ? { reminderClear: true } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={task ? 'Редагувати завдання' : 'Нове завдання'} size="md">
      <div className="form-grid">
        <div className="form-group form-group--full">
          <label className="form-label">Назва *</label>
          <input
            type="text"
            className="form-input"
            value={title}
            onChange={e => { setTitle(e.target.value); setError(''); }}
            placeholder="Наприклад: написати клієнту"
          />
          {error && <small style={{ color: 'var(--danger)' }}>{error}</small>}
        </div>
        <div className="form-group">
          <label className="form-label">Пріоритет</label>
          <select className="form-input" value={priority} onChange={e => setPriority(e.target.value)}>
            {TASK_PRIORITIES.map(p => <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>)}
          </select>
        </div>
        {task && (
          <div className="form-group">
            <label className="form-label">Статус</label>
            <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>
              {TASK_STATUSES.map(st => <option key={st} value={st}>{TASK_STATUS_LABELS[st]}</option>)}
            </select>
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Дедлайн (дата, Kyiv)</label>
          <input type="date" className="form-input" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Час дедлайну</label>
          <input type="time" className="form-input" value={dueTime} onChange={e => setDueTime(e.target.value)} disabled={!dueDate} />
          <small className="form-hint">Без часу день прострочується наступного дня</small>
        </div>
        <div className="form-group">
          <label className="form-label">Нове нагадування (дата)</label>
          <input type="date" className="form-input" value={reminderDate} onChange={e => setReminderDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Час нагадування</label>
          <input type="time" className="form-input" value={reminderTime} onChange={e => setReminderTime(e.target.value)} disabled={!reminderDate} />
          <small className="form-hint">Без часу нагадування не планується — година не вигадується</small>
          {task?.reminderAt && !reminderClear && (
            <small className="form-hint">
              Чинне нагадування: {formatDateTime(task.reminderAt)}{' '}
              <button type="button" className="btn btn-ghost" style={{ padding: '0 4px', fontSize: '0.7rem' }} onClick={() => setReminderClear(true)}>
                Прибрати
              </button>
            </small>
          )}
          {task?.reminderAt && reminderClear && (
            <small className="form-hint" style={{ color: 'var(--danger)' }}>Нагадування буде прибрано після збереження</small>
          )}
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Опис</label>
          <textarea className="form-input form-textarea" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={() => void handleSave()} disabled={saving} saveLabel={saving ? 'Зберігаю…' : 'Зберегти'} />
    </Modal>
  );
}
