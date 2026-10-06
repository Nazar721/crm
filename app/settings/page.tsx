'use client';
import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { getBackupInfo, shouldShowBackupReminder, snoozeBackupReminder, exportData, markManualBackup } from '@/lib/storage';
import { previewImport, applyImport, restoreFromPreviousCopy, type ImportPreview, type ImportReport } from '@/lib/importer';
import { getBackupRuntimeStatus, type BackupRuntimeStatus } from '@/lib/backup';
import { setDisplayCurrency } from '@/lib/actions';
import * as store from '@/lib/store';
import { clearIssues } from '@/lib/store';
import { emitToast } from '@/lib/toast-bus';
import { formatDateTime } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useConfirm } from '@/hooks/useConfirm';
import type { StorageIssue } from '@/lib/datasource/types';

const COLLECTION_LABELS: Record<string, string> = {
  projectsActive: 'Активні проєкти',
  projectsCompleted: 'Завершені проєкти',
  clients: 'Клієнти',
  specialists: 'Фахівці',
  partners: 'Партнери',
  transactions: 'Транзакції',
  personalDebts: 'Борги',
  savings: 'Відкладення',
};

export default function SettingsPage() {
  const { triggerRefresh, reinitialize, snapshot, storageIssues, refreshKey } = useApp();
  const [info, setInfo] = useState({ lastSavedAt: '', lastManualBackupAt: '', backupSnoozedUntil: '' });
  const [backupStatus, setBackupStatus] = useState<BackupRuntimeStatus | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [displayCurrency, setDisplayCurrencyValue] = useState('UAH');
  const [settings, setSettings] = useState({ usdRate: 41, eurRate: 44, usdtRate: 41 });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rawPayload, setRawPayload] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [ackSkipped, setAckSkipped] = useState(false);
  const [issues, setIssues] = useState<StorageIssue[]>(storageIssues);
  const [corrupt, setCorrupt] = useState<string[]>([]);
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();

  const refreshStatuses = () => {
    setInfo(getBackupInfo());
    setShowWarning(shouldShowBackupReminder());
    setBackupStatus(getBackupRuntimeStatus());
  };

  useEffect(() => {
    refreshStatuses();
    setDisplayCurrencyValue(snapshot.financeSettings.displayCurrency || 'UAH');
    setSettings({
      usdRate: snapshot.financeSettings.usdRate,
      eurRate: snapshot.financeSettings.eurRate,
      usdtRate: snapshot.financeSettings.usdtRate ?? snapshot.financeSettings.usdRate,
    });
    setIssues(storageIssues);
    setCorrupt(store.getCorruptCollections());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const incident = snapshot.meta.importIncident ?? null;

  const doRestoreCopy = () => {
    confirm(
      'Відновити попередній стан?',
      'Поточні дані буде замінено копією, знятою перед останнім імпортом. Дію не можна скасувати.',
      () => {
        void (async () => {
          const report = await restoreFromPreviousCopy();
          if (!report.ok) {
            emitToast(
              `Відновлення не завершено (${report.stage}): ${report.issue || 'помилка'}` +
              (report.restoreSkipped?.length ? ` Не відновлено: ${report.restoreSkipped.join(', ')}.` : ''),
              'error',
            );
          } else {
            emitToast('Попередній стан відновлено з копії', 'success');
          }
          await reinitialize();
          refreshStatuses();
          triggerRefresh();
        })();
      },
    );
  };

  const doAcknowledgeIncident = () => {
    confirm(
      'Підтвердити відновлення?',
      'Блокування запису буде знято. Переконайтеся, що дані справді відновлені: змішаний стан можна звірити через експорт JSON.',
      () => {
        void (async () => {
          const ok = await store.acknowledgeImportIncident();
          if (!ok) {
            emitToast('Не вдалося зняти позначку (ліміт сховища)', 'error');
          } else {
            emitToast('Позначку знято — запис даних дозволено', 'success');
          }
          refreshStatuses();
          triggerRefresh();
        })();
      },
    );
  };

  const doBackup = async () => {
    try {
      // Експорт завжди будується з повного snapshot, а не з видимої сторінки.
      const payload = exportData(true);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      const d = new Date();
      a.download = `crm-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      await markManualBackup();
      refreshStatuses();
      triggerRefresh();
      if (store.getWriteBlock()) {
        emitToast(`Файл експортовано, але мітку «остання резервна копія» не вдалося зберегти: ${store.getWriteBlock()}`, 'info');
      }
    } catch (err) {
      emitToast(`Не вдалося створити резервну копію: ${String(err)}`, 'error');
    }
  };

  const startImport = (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onerror = () => emitToast('Не вдалося прочитати файл', 'error');
    reader.onload = () => {
      const emptyCounts = {
        projectsActive: 0, projectsCompleted: 0, clients: 0, specialists: 0,
        partners: 0, transactions: 0, personalDebts: 0, savings: 0,
      };
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result || ''));
      } catch (err) {
        const message = `Некоректний JSON: ${String(err)}`;
        emitToast(message, 'error');
        setRawPayload(null);
        setAckSkipped(false);
        setPreview({
          validation: {
            ok: false, format: 'unknown', version: null, exportedAt: null,
            errors: [{ message }],
            recordIssues: [], counts: { ...emptyCounts }, skipped: { ...emptyCounts },
            warnings: [], content: null, settings: null,
          },
          previousCounts: { ...emptyCounts },
          previousTotal: 0,
          safetyCopyKey: 'crm_import_previous',
        });
        return;
      }
      setRawPayload(parsed);
      setAckSkipped(false);
      setPreview(previewImport(parsed));
    };
    reader.readAsText(file);
  };

  const confirmImport = async () => {
    if (!preview || !preview.validation.ok || rawPayload === null) return;
    setImporting(true);
    try {
      const report: ImportReport = await applyImport(rawPayload);
      if (!report.ok) {
        const skippedNote = report.restoreSkipped?.length
          ? ` Не відновлено колекції: ${report.restoreSkipped.map(c => COLLECTION_LABELS[c] || c).join(', ')}.`
          : '';
        emitToast(
          report.recovered === false
            ? `Імпорт не завершено (${report.stage}): ${report.issue || 'помилка'}. Попередній стан відновити не вдалося — копію збережено у «${preview.safetyCopyKey}». Запис даних заблоковано до відновлення.${skippedNote}`
            : `Імпорт не завершено (${report.stage}): ${report.issue || 'помилка'}. Попередній стан відновлено.${skippedNote}`,
          'error',
        );
        await reinitialize();
        refreshStatuses();
        return;
      }
      await reinitialize();
      refreshStatuses();
      triggerRefresh();
      emitToast(
        preview.validation.recordIssues.length
          ? `Дані імпортовано, але пропущено некоректних записів: ${preview.validation.recordIssues.length}`
          : 'Дані імпортовано',
        preview.validation.recordIssues.length ? 'info' : 'success',
      );
      setPreview(null);
      setRawPayload(null);
    } catch (err) {
      emitToast(`Не вдалося імпортувати: ${String(err)}`, 'error');
    } finally {
      setImporting(false);
    }
  };

  const snooze = async () => { await snoozeBackupReminder(); refreshStatuses(); emitToast('Нагадаю пізніше', 'info'); };

  const changeDisplayCurrency = async (cur: string) => {
    const result = await setDisplayCurrency(cur as 'UAH' | 'USD' | 'EUR');
    if (!result.ok) {
      emitToast(result.errors.map(e => e.message).join('; '), 'error');
      return;
    }
    setDisplayCurrencyValue(cur);
    triggerRefresh();
  };

  return (
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Налаштування</h1><p className="page-subtitle">Резервні копії, експорт та відновлення CRM</p></div>
      </div>
      <div className="settings-grid">
        <div className="settings-card">
          <h3 className="settings-title">Валюта відображення</h3>
          <p className="settings-text">Усі суми в CRM відображатимуться у вибраній валюті.</p>
          <div style={{ marginTop: 12 }}>
            <label className="form-label" style={{ marginBottom: 6, display: 'block' }}>Показувати все в:</label>
            <select className="form-input" style={{ maxWidth: 220 }} value={displayCurrency} onChange={e => changeDisplayCurrency(e.target.value)}>
              <option value="UAH">₴ Гривня (UAH)</option>
              <option value="USD">$ Долар (USD)</option>
              <option value="EUR">€ Євро (EUR)</option>
            </select>
          </div>
          <div style={{ marginTop: 12, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            <span>Поточні курси: </span>
            <strong>1$ = {settings.usdRate}₴</strong> · <strong>1€ = {settings.eurRate}₴</strong> · <strong>1 USDT = {settings.usdtRate}₴</strong>
            <span style={{ marginLeft: 8 }}>(редагуються на сторінці Фінанси)</span>
          </div>
        </div>

        <div className="settings-card">
          <h3 className="settings-title">Резервна копія</h3>
          <p className="settings-text">
            Експорт та імпорт усіх локальних даних CRM у JSON-файл. Файл містить версію схеми,
            дати, зв’язки, усі записи та налаштування; секрети виключені.
          </p>
          <div className="header-actions">
            <button className="btn btn-primary" onClick={doBackup}>Завантажити резервну копію</button>
            <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
              Імпорт даних
              <input
                type="file"
                data-import-source
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={e => { startImport(e.target.files?.[0]); e.target.value = ''; }}
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
            <p className="settings-text" style={{ fontSize: '0.82rem' }}>
              Перегляд і експорт JSON доступні. Запис даних заблоковано, допоки стан не відновлено
              через копію або не підтверджено вручну. Повторна ініціалізація та перезапуск
              цю позначку не знімають.
            </p>
            <div className="header-actions" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={doRestoreCopy}>Відновити з копії</button>
              <button className="btn btn-ghost" onClick={doAcknowledgeIncident}>Підтвердити відновлення</button>
              <button className="btn btn-ghost" onClick={doBackup}>Експортувати JSON</button>
            </div>
          </div>
        )}

        <div className="settings-card" style={{ gridColumn: '1 / -1' }}>
          <h3 className="settings-title">Стан збереження</h3>
          <div className="settings-info-row"><span>Останнє збереження</span><strong>{info.lastSavedAt ? `${formatDateTime(info.lastSavedAt)} ✓` : '—'}</strong></div>
          <div className="settings-info-row"><span>Остання резервна копія</span><strong>{info.lastManualBackupAt ? `${formatDateTime(info.lastManualBackupAt)} 💾` : '—'}</strong></div>
          <div className="settings-info-row"><span>Записів у базі</span><strong>
            {snapshot.projectsActive.length + snapshot.projectsCompleted.length} проєктів · {snapshot.clients.length} клієнтів · {snapshot.transactions.length} транзакцій
          </strong></div>
          <div className="settings-info-row">
            <span>Колекції з пошкодженими даними</span>
            <strong style={{ color: corrupt.length ? 'var(--danger)' : 'var(--accent-green)' }}>
              {corrupt.length
                ? `${corrupt.map(c => COLLECTION_LABELS[c] || c).join(', ')} — запис заблоковано до відновлення`
                : 'немає'}
            </strong>
          </div>
          <p className="settings-text" style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            Стан даних не залежить від журналу нижче: очищення журналу прибирає лише повідомлення,
            а не робить пошкоджені дані валідними.
          </p>
          {issues.length > 0 && (
            <div className="backup-warning" style={{ marginTop: 12 }}>
              <strong>Проблеми з локальним сховищем ({issues.length})</strong>
              <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                {issues.map(i => (
                  <li key={i.id} style={{ marginBottom: 4 }}>
                    {i.message}
                    {i.preservedAt && <span> — оригінал збережено в «{i.preservedAt}»</span>}
                  </li>
                ))}
              </ul>
              <div className="header-actions" style={{ marginTop: 10 }}>
                <button className="btn btn-ghost" onClick={() => { clearIssues(); setIssues([]); }}>Очистити журнал</button>
              </div>
            </div>
          )}
          {showWarning && (
            <div className="backup-warning">
              <strong>Ви давно не створювали резервну копію.</strong>
              <span>Рекомендуємо завантажити JSON-файл.</span>
              <div className="header-actions">
                <button className="btn btn-primary" onClick={doBackup}>Створити зараз</button>
                <button className="btn btn-ghost" onClick={() => { void snooze(); }}>Нагадати пізніше</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={!!preview} onClose={() => { if (!importing) setPreview(null); }} title={`Імпорт: ${fileName || 'файл'}`} size="lg">
        {preview && (
          <>
            <div className="settings-info-row">
              <span>Формат</span>
              <strong>
                {preview.validation.format === 'unknown'
                  ? 'невідомий'
                  : preview.validation.format === 'legacy-flat'
                    ? 'старий (legacy-flat)'
                    : preview.validation.format.toUpperCase()}
                {preview.validation.version !== null ? ` · версія ${preview.validation.version}` : ''}
              </strong>
            </div>
            {preview.validation.exportedAt && (
              <div className="settings-info-row"><span>Файл створено</span><strong>{formatDateTime(preview.validation.exportedAt)}</strong></div>
            )}

            {!preview.validation.ok ? (
              <div className="backup-warning" style={{ marginTop: 12 }}>
                <strong>Імпорт неможливий — файл відхилено до будь-якого запису.</strong>
                <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                  {preview.validation.errors.slice(0, 20).map((e, i) => <li key={i}>{e.message}</li>)}
                </ul>
              </div>
            ) : (
              <>
                <h3 className="settings-title" style={{ marginTop: 14 }}>Записи у файлі</h3>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Колекція</th><th>Зараз</th><th>Приймано</th><th>Стане</th><th>Пропущено</th></tr></thead>
                    <tbody>
                      {Object.keys(COLLECTION_LABELS).map(key => (
                        <tr key={key}>
                          <td>{COLLECTION_LABELS[key]}</td>
                          <td>{(preview.previousCounts as Record<string, number>)[key] ?? 0}</td>
                          <td>{(preview.validation.counts as Record<string, number>)[key] ?? 0}</td>
                          <td style={{ color: 'var(--accent-green)' }}>{(preview.validation.counts as Record<string, number>)[key] ?? 0}</td>
                          <td style={{ color: (preview.validation.skipped as Record<string, number>)[key] ? 'var(--accent-orange)' : 'var(--text-secondary)' }}>
                            {(preview.validation.skipped as Record<string, number>)[key] ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 12 }}>
                  Поточні дані ({preview.previousTotal} записів) будуть замінені. Перед записом буде створено
                  копію попереднього стану в «{preview.safetyCopyKey}». Операція не є атомарною: при збої
                  виконується відновлення, а якщо й воно не вдасться — ви отримаєте явний стан помилки.
                </p>

                {preview.validation.recordIssues.length > 0 && (
                  <div className="backup-warning" style={{ marginTop: 10 }}>
                    <strong>Некоректні записи ({preview.validation.recordIssues.length}) — буде пропущено:</strong>
                    <ul style={{ margin: '8px 0 0 18px', padding: 0 }}>
                      {preview.validation.recordIssues.slice(0, 10).map((e, i) => (
                        <li key={i}>
                          {e.collection ? `${COLLECTION_LABELS[e.collection] || e.collection}${e.id ? ` · ${e.id}` : ''}: ` : ''}{e.message}
                        </li>
                      ))}
                      {preview.validation.recordIssues.length > 10 && <li>… ще {preview.validation.recordIssues.length - 10}</li>}
                    </ul>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={ackSkipped}
                        onChange={e => setAckSkipped(e.target.checked)}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        Я розумію, що ці {preview.validation.recordIssues.length} записів НЕ буде імпортовано,
                        і даю згоду на заміну поточних даних без них.
                      </span>
                    </label>
                  </div>
                )}

                {preview.validation.warnings.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
                    <strong>Попередження:</strong>
                    <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
                      {preview.validation.warnings.slice(0, 10).map((w, i) => <li key={i}>{w.message}</li>)}
                      {preview.validation.warnings.length > 10 && <li>… ще {preview.validation.warnings.length - 10}</li>}
                    </ul>
                  </div>
                )}
              </>
            )}

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setPreview(null)} disabled={importing}>Скасувати</button>
              <button
                className="btn btn-primary"
                onClick={confirmImport}
                disabled={!preview.validation.ok || importing || (preview.validation.recordIssues.length > 0 && !ackSkipped)}
              >
                {importing ? 'Імпортую…' : 'Імпортувати'}
              </button>
            </div>
          </>
        )}
      </Modal>
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
