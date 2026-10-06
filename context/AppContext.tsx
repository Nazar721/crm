'use client';
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { DataSnapshot } from '@/types';
import type { StorageIssue } from '@/lib/datasource/types';
import * as store from '@/lib/store';
import { runMigrations, type MigrationReport } from '@/lib/migrations';
import { emitToast } from '@/lib/toast-bus';

interface BadgeCounts {
  projects: number;
  clients: number;
  specialists: number;
  partners: number;
}

export type AppStatus = 'loading' | 'ready' | 'error';

interface AppContextType {
  status: AppStatus;
  error: string | null;
  /** Актуальний snapshot даних у пам'яті (порожній, поки status !== 'ready'). */
  snapshot: DataSnapshot;
  storageIssues: StorageIssue[];
  /** Якщо запис заблоковано (ліміт сховища / незавершені міграції) — показується банер. */
  writeBlock: string | null;
  badges: BadgeCounts;
  refreshBadges: () => void;
  refreshKey: number;
  triggerRefresh: () => void;
  /** Повторна ініціалізація: перечитати сховище + міграції (після імпорту). */
  reinitialize: () => Promise<MigrationReport | null>;
  retry: () => void;
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  closeSidebar: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const EMPTY_SNAPSHOT: DataSnapshot = {
  projectsActive: [],
  projectsCompleted: [],
  clients: [],
  specialists: [],
  partners: [],
  transactions: [],
  personalDebts: [],
  savings: [],
  financeSettings: { usdRate: 41, eurRate: 44, usdtRate: 41, displayCurrency: 'UAH' },
  meta: { lastSavedAt: '', lastManualBackupAt: '', backupSnoozedUntil: '' },
};

function countBadges(snapshot: DataSnapshot): BadgeCounts {
  return {
    projects: snapshot.projectsActive.length,
    clients: snapshot.clients.length,
    specialists: snapshot.specialists.length,
    partners: snapshot.partners.length,
  };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<DataSnapshot>(EMPTY_SNAPSHOT);
  const [storageIssues, setStorageIssues] = useState<StorageIssue[]>([]);
  const [writeBlock, setWriteBlock] = useState<string | null>(null);
  const [badges, setBadges] = useState<BadgeCounts>(countBadges(EMPTY_SNAPSHOT));
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const reportedIssues = useRef<Set<string>>(new Set());

  // Підписка на зміни сховища: всі сторінки отримують новий snapshot
  // після будь-якого запису (сторінка, імпорт, міграція).
  useEffect(() => {
    const sync = () => {
      setSnapshot(store.getSnapshot());
      setBadges(countBadges(store.getSnapshot()));
      setStorageIssues(store.getIssues());
      setWriteBlock(store.getWriteBlock());
      setRefreshKey(k => k + 1);
    };
    sync();
    return store.subscribe(sync);
  }, []);

  // Явні помилки сховища (пошкоджений JSON, перевищена квота) — показуємо один раз.
  useEffect(() => {
    if (status !== 'ready') return;
    storageIssues.forEach(issue => {
      if (reportedIssues.current.has(issue.id)) return;
      reportedIssues.current.add(issue.id);
      emitToast(issue.message, 'error');
    });
  }, [storageIssues, status]);

  const boot = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      await store.initStore();
      if (store.getStoreStatus() === 'error') {
        setStatus('error');
        setError(store.getStoreError());
        return;
      }
      // Міграції виконуються до того, як дані стають доступними для редагування.
      // Якщо якась не виконалася — запис даних блокується (див. runMigrations).
      const report = await runMigrations();
      await store.reloadStore();
      setSnapshot(store.getSnapshot());
      setBadges(countBadges(store.getSnapshot()));
      setStorageIssues(store.getIssues());
      setWriteBlock(store.getWriteBlock());
      if (report.failed.length) {
        emitToast(`Міграції не застосовано: ${report.failed.join(', ')}. Редагування даних заблоковано.`, 'error');
      }
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const reinitialize = useCallback(async () => {
    try {
      const report = await runMigrations();
      await store.reloadStore();
      setSnapshot(store.getSnapshot());
      setBadges(countBadges(store.getSnapshot()));
      setStorageIssues(store.getIssues());
      setWriteBlock(store.getWriteBlock());
      setRefreshKey(k => k + 1);
      return report;
    } catch (err) {
      emitToast(err instanceof Error ? err.message : String(err), 'error');
      return null;
    }
  }, []);

  const refreshBadges = useCallback(() => {
    setBadges(countBadges(store.getSnapshot()));
  }, []);

  const triggerRefresh = useCallback(() => {
    setSnapshot(store.getSnapshot());
    setBadges(countBadges(store.getSnapshot()));
    setStorageIssues(store.getIssues());
    setRefreshKey(prev => prev + 1);
  }, []);

  const retry = useCallback(() => setAttempt(a => a + 1), []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const value = useMemo<AppContextType>(() => ({
    status,
    error,
    snapshot,
    storageIssues,
    writeBlock,
    badges,
    refreshBadges,
    refreshKey,
    triggerRefresh,
    reinitialize,
    retry,
    sidebarOpen,
    setSidebarOpen,
    closeSidebar,
  }), [status, error, snapshot, storageIssues, writeBlock, badges, refreshBadges, refreshKey, triggerRefresh, reinitialize, retry, sidebarOpen, closeSidebar]);

  return (
    <AppContext.Provider value={value}>
      {status === 'ready' ? (
        <>
          {writeBlock && (
            <div className="write-block-banner" role="alert">
              <strong>Запис даних заблоковано.</strong>
              <span>{writeBlock}</span>
              <Link className="btn btn-ghost btn--sm" href="/settings">Налаштування / експорт</Link>
            </div>
          )}
          {children}
        </>
      ) : (
        <div className="app-shell-state" role="status" aria-live="polite">
          {status === 'loading' ? (
            <>
              <div className="app-shell-spinner" aria-hidden="true" />
              <p className="app-shell-title">Завантаження даних CRM…</p>
              <p className="app-shell-text">Читаємо локальне сховище, застосовуємо міграції</p>
            </>
          ) : (
            <>
              <p className="app-shell-title">Не вдалося відкрити локальне сховище</p>
              <p className="app-shell-text">{error || 'Невідома помилка'}</p>
              <div className="header-actions" style={{ justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={retry}>Спробувати ще</button>
              </div>
              <p className="app-shell-text">
                Якщо проблема повторюється — відкрийте сторінку «Налаштування» після відновлення
                доступу та імпортуйте резервну копію.
              </p>
            </>
          )}
        </div>
      )}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
