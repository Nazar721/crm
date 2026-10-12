'use client';
import { formatDateTime } from '@/lib/utils';
import type { BackupRuntimeStatus } from '@/lib/backup';
import type { ImportIncident } from '@/types';

/**
 * Вкладка «Копії та імпорт»: презентаційна секція.
 * Уся логіка (експорт/імпорт/відновлення) лишається на сторінці
 * й передається пропсами — дублювання запису немає.
 */
interface BackupSettingsSectionProps {
  backupStatus: BackupRuntimeStatus | null;
  incident: ImportIncident | null;
  showWarning: boolean;
  onBackup: () => void;
  onSnooze: () => void;
  onImportFile: (file: File | undefined) => void;
  onRestoreCopy: () => void;
  onAcknowledgeIncident: () => void;
}

export default function BackupSettingsSection({
  backupStatus,
  incident,
  showWarning,
  onBackup,
  onSnooze,
  onImportFile,
  onRestoreCopy,
  onAcknowledgeIncident,
}: BackupSettingsSectionProps) {
  return (
    <div className="settings-grid">
      <div className="settings-card">
        <h3 className="settings-title">Резервна копія</h3>
        <p className="settings-text">
          Експорт та імпорт усіх локальних даних CRM у JSON-файл. Файл містить версію схеми,
          дати, зв’язки, усі записи та налаштування; секрети виключені.
        </p>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={onBackup}>Завантажити резервну копію</button>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            Імпорт даних
            <input
              type="file"
              data-import-source
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={e => { onImportFile(e.target.files?.[0]); e.target.value = ''; }}
            />
          </label>
        </div>
        {backupStatus && (
          <div style={{ marginTop: 12, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            <div>Повна копія: {backupStatus.lastRotationAt ? formatDateTime(backupStatus.lastRotationAt) : 'ще не створювалась'}</div>
            <div>
              Стан:{' '}
              {backupStatus.pending
                ? <strong style={{ color: 'var(--accent-orange)' }}>є незбережені зміни (копія оновлюється)</strong>
                : <strong style={{ color: 'var(--accent-green)' }}>актуальна</strong>}
            </div>
            {backupStatus.lastError && <div style={{ color: 'var(--danger)' }}>{backupStatus.lastError}</div>}
          </div>
        )}
      </div>

      <div className="settings-card">
        <h3 className="settings-title">Правило відновлення</h3>
        <p className="settings-text">
          Перед імпортом створюється копія попереднього стану. Якщо зв’язок перерветься —
          перевірте результат після оновлення сторінки перед повторною спробою.
          Не повторюйте запис автоматично новим ID: загублена відповідь може означати виконаний запис.
        </p>
        <p className="settings-text" style={{ marginTop: 8, fontSize: '0.82rem' }}>
          Перегляд і експорт JSON доступні завжди. Запис даних блокується, допоки стан
          не відновлено через копію або не підтверджено вручну.
        </p>
      </div>

      {incident && (
        <div className="settings-card" style={{ gridColumn: '1 / -1', border: '1px solid rgba(255,69,58,0.45)' }}>
          <h3 className="settings-title" style={{ color: 'var(--danger)' }}>Незавершений імпорт</h3>
          <p className="settings-text">{incident.reason}</p>
          <div className="settings-info-row">
            <span>Зафіксовано</span>
            <strong>{incident.at ? formatDateTime(incident.at) : '—'}</strong>
          </div>
          {incident.stage && (
            <div className="settings-info-row"><span>Етап</span><strong>{incident.stage}</strong></div>
          )}
          <div className="settings-info-row">
            <span>Стан</span>
            <strong style={{ color: incident.recovered === false ? 'var(--danger)' : 'var(--accent-orange)' }}>
              {incident.recovered === false ? 'відновлення не вдалося — дані можуть бути змішаними' : 'стан не підтверджено'}
            </strong>
          </div>
          <div className="header-actions" style={{ marginTop: 10 }}>
            <button className="btn btn-primary" onClick={onRestoreCopy}>Відновити з копії</button>
            <button className="btn btn-ghost" onClick={onAcknowledgeIncident}>Підтвердити відновлення</button>
            <button className="btn btn-ghost" onClick={onBackup}>Експортувати JSON</button>
          </div>
        </div>
      )}

      {showWarning && !incident && (
        <div className="backup-warning" style={{ gridColumn: '1 / -1' }}>
          <strong>Ви давно не створювали резервну копію.</strong>
          <span>Рекомендуємо завантажити JSON-файл.</span>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={onBackup}>Створити зараз</button>
            <button className="btn btn-ghost" onClick={() => { void onSnooze(); }}>Нагадати пізніше</button>
          </div>
        </div>
      )}
    </div>
  );
}
