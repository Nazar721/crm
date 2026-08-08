'use client';
import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { getBackupInfo, shouldShowBackupReminder, snoozeBackupReminder, exportData, importData, markManualBackup } from '@/lib/storage';
import { formatDateTime } from '@/lib/utils';

export default function SettingsPage() {
  const { triggerRefresh } = useApp();
  const [info, setInfo] = useState({ lastSavedAt: '', lastManualBackupAt: '', backupSnoozedUntil: '' });
  const [showWarning, setShowWarning] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined') {
      setInfo(getBackupInfo());
      setShowWarning(shouldShowBackupReminder());
    }
  }, []);

  const doExport = () => {
    const payload = exportData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    const d = new Date();
    a.download = `webcrm-export-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const doBackup = () => {
    markManualBackup();
    const payload = exportData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    const d = new Date();
    a.download = `crm-backup-${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}.json`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setInfo(getBackupInfo());
    setShowWarning(shouldShowBackupReminder());
  };

  const doImport = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result as string);
        if (confirm('Імпортувати backup? Поточні дані CRM будуть замінені.')) {
          importData(payload);
          setInfo(getBackupInfo());
          triggerRefresh();
          alert('Дані імпортовано');
        }
      } catch { alert('Не вдалося прочитати JSON файл'); }
    };
    reader.readAsText(file);
  };

  const snooze = () => { snoozeBackupReminder(); setInfo(getBackupInfo()); setShowWarning(shouldShowBackupReminder()); alert('Нагадаю пізніше'); };

  return (
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Налаштування</h1><p className="page-subtitle">Резервні копії, експорт та відновлення CRM</p></div>
      </div>
      <div className="settings-grid">
        <div className="settings-card">
          <h3 className="settings-title">Дані CRM</h3>
          <p className="settings-text">Експорт та імпорт усіх локальних даних CRM у JSON-файл.</p>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={doExport}>Експорт усіх даних</button>
            <button className="btn btn-ghost" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json,.json'; i.onchange = (e) => doImport((e.target as HTMLInputElement).files?.[0]); i.click(); }}>Імпорт усіх даних</button>
          </div>
        </div>
        <div className="settings-card">
          <h3 className="settings-title">Резервна копія</h3>
          <p className="settings-text">Завантаження ручної копії та відновлення з JSON-файлу.</p>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={doBackup}>Завантажити резервну копію</button>
            <button className="btn btn-ghost" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json,.json'; i.onchange = (e) => doImport((e.target as HTMLInputElement).files?.[0]); i.click(); }}>Імпорт резервної копії</button>
          </div>
        </div>
        <div className="settings-card" style={{ gridColumn: '1 / -1' }}>
          <h3 className="settings-title">Стан збереження</h3>
          <div className="settings-info-row"><span>Останнє збереження</span><strong>{mounted && info.lastSavedAt ? `${formatDateTime(info.lastSavedAt)} ✓` : '—'}</strong></div>
          <div className="settings-info-row"><span>Остання резервна копія</span><strong>{mounted && info.lastManualBackupAt ? `${formatDateTime(info.lastManualBackupAt)} 💾` : '—'}</strong></div>
          {showWarning && (
            <div className="backup-warning">
              <strong>Ви давно не створювали резервну копію.</strong>
              <span>Рекомендуємо завантажити JSON-файл.</span>
              <div className="header-actions">
                <button className="btn btn-primary" onClick={doBackup}>Створити зараз</button>
                <button className="btn btn-ghost" onClick={snooze}>Нагадати пізніше</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
