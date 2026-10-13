'use client';
import { useEffect, useState } from 'react';
import { useApp } from '@/context/AppContext';
import { formatDateTime } from '@/lib/utils';
import {
  browserNotificationsSupported, dueReminders, inAppRemindersEnabled, setInAppRemindersEnabled,
  taskSchedule,
} from '@/lib/tasks';
import { emitToast } from '@/lib/toast-bus';

// ============================================================
// Пакет 05: «Налаштування → Нагадування».
// Сповіщення в CRM (поки застосунок відкритий) + фактичний стан.
// Системний дозвіл НЕ запитується при завантаженні — лише за явною
// кнопкою. Browser Notifications не гарантують доставку при закритому
// застосунку; віддова не ламає завдання.
// ============================================================

export default function RemindersSettingsSection() {
  const { snapshot } = useApp();
  const [enabled, setEnabled] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');

  useEffect(() => {
    setEnabled(inAppRemindersEnabled());
    if (browserNotificationsSupported()) {
      setPermission(Notification.permission);
    } else {
      setPermission('unsupported');
    }
  }, []);

  const due = dueReminders(snapshot.tasks);
  const upcoming = snapshot.tasks
    .filter(t => t.status === 'planned' && t.reminderAt && !t.reminderShownAt)
    .sort((a, b) => String(a.reminderAt).localeCompare(String(b.reminderAt)))
    .slice(0, 5);

  const requestBrowserPermission = async () => {
    if (!browserNotificationsSupported()) {
      emitToast('Браузер не підтримує сповіщення', 'error');
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        emitToast('Дозвіл надано. Сповіщення можливі, поки вкладка відкрита; при закритому застосунку доставка не гарантується.', 'success');
      } else {
        emitToast('Дозвіл не надано — завдання та нагадування в CRM продовжують працювати', 'info');
      }
    } catch {
      emitToast('Не вдалося запитати дозвіл', 'error');
    }
  };

  return (
    <div className="settings-grid">
      <div className="settings-card" style={{ gridColumn: '1 / -1' }}>
        <h3 className="settings-title">Сповіщення в CRM</h3>
        <p className="settings-text" style={{ marginTop: 0 }}>
          Нагадування показуються в інтерфейсі, поки застосунок відкритий (періодична перевірка
          та при поверненні на сторінку). Захист від повторного показу зберігається в завданні
          (узгоджується між пристроями). <strong>Доставка при закритому застосунку чи на
          заблокованому пристрої не реалізована</strong> — це окрема наступна інтеграція
          (серверний планувальник + Web Push), і не обіцяється цим пакетом.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => {
              setInAppRemindersEnabled(e.target.checked);
              setEnabled(e.target.checked);
            }}
          />
          Показувати нагадування в інтерфейсі CRM
        </label>
        <div className="settings-info-row" style={{ marginTop: 10 }}>
          <span>Системні сповіщення браузера</span>
          <strong>
            {permission === 'unsupported'
              ? 'не підтримуються цим браузером'
              : permission === 'granted'
                ? 'дозволено (без гарантії при закритому застосунку)'
                : permission === 'denied'
                  ? 'заборонено — завдання працюють без них'
                  : 'дозвіл не запитувався'}
          </strong>
        </div>
        {permission !== 'granted' && permission !== 'unsupported' && (
          <div style={{ marginTop: 8 }}>
            <button className="btn btn-ghost" onClick={() => void requestBrowserPermission()}>
              Дозволити системні сповіщення
            </button>
            <small className="form-hint" style={{ marginLeft: 8 }}>
              Лише за вашою явною дією; віддова нічого не ламає
            </small>
          </div>
        )}
      </div>

      <div className="settings-card" style={{ gridColumn: '1 / -1' }}>
        <h3 className="settings-title">Стан нагадувань</h3>
        <div className="settings-info-row"><span>Настали й не показані</span><strong>{due.length}</strong></div>
        <div className="settings-info-row"><span>Завдань усього</span><strong>{snapshot.tasks.length}</strong></div>
        {upcoming.length > 0 && (
          <>
            <h3 className="settings-title" style={{ marginTop: 12 }}>Найближчі нагадування</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {upcoming.map(task => (
                <li key={task.id} style={{ marginBottom: 4, fontSize: '0.85rem' }}>
                  «{task.title}» — {formatDateTime(task.reminderAt!)}
                  {taskSchedule(task).overdue ? ' (дедлайн прострочено)' : ''}
                </li>
              ))}
            </ul>
          </>
        )}
        {upcoming.length === 0 && (
          <p className="settings-text">Запланованих нагадувань немає.</p>
        )}
      </div>
    </div>
  );
}
