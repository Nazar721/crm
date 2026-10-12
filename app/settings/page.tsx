'use client';
import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/context/AppContext';
import { getBackupInfo, shouldShowBackupReminder, snoozeBackupReminder, exportData, markManualBackup } from '@/lib/storage';
import { previewImport, applyImport, restoreFromPreviousCopy, type ImportPreview, type ImportReport } from '@/lib/importer';
import { getBackupRuntimeStatus, type BackupRuntimeStatus } from '@/lib/backup';
import {
  SETTINGS_TABS,
  resolveSettingsTabParam,
  settingsTabHref,
  type SettingsTabId,
} from '@/lib/settings-tabs';
import { usePersistedState } from '@/hooks/useUiState';
import FinanceSettingsSection from '@/components/settings/FinanceSettingsSection';
import AssistantSettingsSection from '@/components/settings/AssistantSettingsSection';
import BackupSettingsSection from '@/components/settings/BackupSettingsSection';
import SystemSettingsSection from '@/components/settings/SystemSettingsSection';
import * as store from '@/lib/store';
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
  return (
    <Suspense fallback={
      <section className="page active">
        <div className="page-header">
          <div><h1 className="page-title">Налаштування</h1><p className="page-subtitle">Завантаження…</p></div>
        </div>
      </section>
    }>
      <SettingsTabsBody />
    </Suspense>
  );
}

function SettingsTabsBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { triggerRefresh, reinitialize, snapshot, storageIssues, refreshKey } = useApp();
  // URL — єдине актуальне джерело вкладки після входу. sessionStorage —
  // лише fallback для ПЕРШОГО entry без `?tab=` (далі entry канонізується
  // через replace, тож Back завжди має визначену вкладку).
  // Перший рендер збігається з SSR (finance); реальна вкладка
  // встановлюється реактивно з useSearchParams (mount, кліки, Back/Forward,
  // внутрішні Next-переходи на той самий pathname з новим query).
  const [storedTab, setStoredTab] = usePersistedState<SettingsTabId>('settings:tab', 'finance');
  const hasTab = searchParams.has('tab');
  const rawTab = searchParams.get('tab');
  const tab: SettingsTabId = resolveSettingsTabParam(hasTab, rawTab, storedTab);
  const [info, setInfo] = useState({ lastSavedAt: '', lastManualBackupAt: '', backupSnoozedUntil: '' });
  const [backupStatus, setBackupStatus] = useState<BackupRuntimeStatus | null>(null);
  const [showWarning, setShowWarning] = useState(false);
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

  // Канонізація entry: перший вхід без `?tab=` отримує визначений URL
  // (fallback sessionStorage → replace), тож Back повертає на вкладку,
  // а не на адресу без стану. Недійсний `?tab=` нормалізується до finance
  // так само через replace (історія не засмічується).
  // Невідкладна навігація (кліки, банер, Back/Forward, внутрішні Next Link)
  // оновлює useSearchParams → tab перераховується реактивно, без ручних
  // слухачів popstate.
  useEffect(() => {
    const expected = settingsTabHref(tab);
    let current = '';
    try {
      current = `${window.location.pathname}${window.location.search}`;
    } catch {
      return;
    }
    if (current !== expected) {
      try {
        router.replace(expected);
      } catch {
        // Немає доступу до router — вкладка все одно показана з URL-розрахунку.
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTab, rawTab]);

  // sessionStorage — лише необов'язковий fallback першого entry:
  // запам'ятовуємо останню ПОКАЗАНУ вкладку для наступного візиту без `?tab=`.
  useEffect(() => {
    try {
      setStoredTab(tab);
    } catch {
      // Немає доступу до sessionStorage — URL лишається джерелом.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Клік по вкладці — звичайна Next-навігація (push): працює Back/Forward,
  // відкриття в новій вкладці (href), внутрішні переходи з банера.
  // preventDefault НЕ викликаємо, щоб не ламати стандартну поведінку посилань.
  const selectTab = (next: SettingsTabId) => {
    if (next === tab) return;
    try {
      router.push(settingsTabHref(next));
    } catch {
      try {
        setStoredTab(next);
      } catch {
        // Немає ні router, ні sessionStorage — лишається поточна вкладка.
      }
    }
  };

  useEffect(() => {
    refreshStatuses();
    setIssues(storageIssues);
    setCorrupt(store.getCorruptCollections());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const incident = snapshot.meta.importIncident ?? null;

  const doRestoreCopy = () => {
    confirm(
      'Відновити попередній стан?',
      'Поточні дані буде замінено початковою копією — точкою, на яку посилається цей інцидент. Дію не можна скасувати.',
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
          store.remoteEnabled()
            ? `Імпорт не підтверджено: ${report.issue || report.errors.map(e => e.message).join('; ') || 'помилка з’єднання'}. Перевір дані після оновлення перед повторною спробою.`
            : report.recovered === false
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

  const reloadAfterSettingsChange = () => {
    refreshStatuses();
    triggerRefresh();
  };

  const subtitle: Record<SettingsTabId, string> = {
    finance: 'Валюта відображення та курси',
    assistant: 'Провайдер і модель AI-помічника',
    backup: 'Резервні копії, експорт та відновлення CRM',
    system: 'Збереження, стан даних і журнал',
  };

  return (
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Налаштування</h1><p className="page-subtitle">{subtitle[tab]}</p></div>
      </div>
      <div className="tabs" role="tablist" aria-label="Розділи налаштувань">
        {SETTINGS_TABS.map(t => (
          <a
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            title={t.hint}
            href={settingsTabHref(t.id)}
            onClick={e => {
              // Стандартний клік — через Next router (історія + Back/Forward);
              // модифікований клік (нова вкладка/вікно) лишаємо браузеру.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              selectTab(t.id);
            }}
          >
            {t.label}
          </a>
        ))}
      </div>
      {/* P2: усі секції лишаються змонтованими — незбережений ввід
          (курси, провайдер до збереження) не знищується перемиканням.
          Приховані секції ховаються через hidden, а не розмонтування. */}
      <div hidden={tab !== 'finance'} aria-hidden={tab !== 'finance'}>
        <FinanceSettingsSection onChanged={reloadAfterSettingsChange} />
      </div>
      <div hidden={tab !== 'assistant'} aria-hidden={tab !== 'assistant'}>
        <AssistantSettingsSection />
      </div>
      {tab === 'backup' && (
        <BackupSettingsSection
          backupStatus={backupStatus}
          incident={incident}
          showWarning={showWarning}
          onBackup={doBackup}
          onSnooze={snooze}
          onImportFile={startImport}
          onRestoreCopy={doRestoreCopy}
          onAcknowledgeIncident={doAcknowledgeIncident}
        />
      )}
      {tab === 'system' && (
        <SystemSettingsSection
          info={info}
          counts={{
            projects: snapshot.projectsActive.length + snapshot.projectsCompleted.length,
            clients: snapshot.clients.length,
            transactions: snapshot.transactions.length,
          }}
          corrupt={corrupt}
          issues={issues}
          onIssuesCleared={() => setIssues([])}
        />
      )}
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
                  копію попереднього стану в «{preview.safetyCopyKey}».{' '}
                  {store.remoteEnabled()
                    ? 'У базі всі колекції та налаштування зберігаються однією операцією. Якщо зв’язок перерветься, перевір результат після оновлення сторінки перед повторною спробою.'
                    : 'Операція не є атомарною: при збої виконується відновлення, а якщо й воно не вдасться — ви отримаєте явний стан помилки.'}
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
