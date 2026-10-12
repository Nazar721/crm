'use client';
import { clearIssues } from '@/lib/store';
import { formatDateTime } from '@/lib/utils';
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

/**
 * Вкладка «Система»: стан збереження, пошкоджені колекції, журнал.
 * Презентаційна секція — читає snapshot через пропси, запису немає
 * (крім очищення журналу, яке й раніше не чіпало здоров'я даних).
 */
interface SystemSettingsSectionProps {
  info: { lastSavedAt: string; lastManualBackupAt: string; backupSnoozedUntil: string };
  counts: { projects: number; clients: number; transactions: number };
  corrupt: string[];
  issues: StorageIssue[];
  onIssuesCleared: () => void;
}

export default function SystemSettingsSection({
  info,
  counts,
  corrupt,
  issues,
  onIssuesCleared,
}: SystemSettingsSectionProps) {
  return (
    <div className="settings-grid">
      <div className="settings-card" style={{ gridColumn: '1 / -1' }}>
        <h3 className="settings-title">Стан збереження</h3>
        <div className="settings-info-row"><span>Останнє збереження</span><strong>{info.lastSavedAt ? `${formatDateTime(info.lastSavedAt)} ✓` : '—'}</strong></div>
        <div className="settings-info-row"><span>Остання резервна копія</span><strong>{info.lastManualBackupAt ? `${formatDateTime(info.lastManualBackupAt)} 💾` : '—'}</strong></div>
        <div className="settings-info-row"><span>Записів у базі</span><strong>
          {counts.projects} проєктів · {counts.clients} клієнтів · {counts.transactions} транзакцій
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
              <button className="btn btn-ghost" onClick={() => { clearIssues(); onIssuesCleared(); }}>Очистити журнал</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
