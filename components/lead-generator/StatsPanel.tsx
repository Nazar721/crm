'use client';

import { useMemo } from 'react';
import { Lead, Run } from '@/lib/lead-generator/types';

interface Props {
  leads: Lead[];
  runs: Run[];
}

export default function StatsPanel({ leads, runs }: Props) {
  const stats = useMemo(() => {
    if (leads.length === 0) return null;

    const withEmail = leads.filter((l) => l.emails.length > 0).length;
    const withPhone = leads.filter((l) => l.phones.length > 0).length;
    const withForm = leads.filter((l) => l.hasContactForm).length;
    const withAny = leads.filter((l) => l.emails.length > 0 || l.phones.length > 0 || l.hasContactForm).length;

    const techCount = new Map<string, number>();
    for (const lead of leads) {
      for (const tech of lead.technologies) {
        techCount.set(tech, (techCount.get(tech) || 0) + 1);
      }
    }
    const topTech = Array.from(techCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const buckets = [
      { label: '80–100', min: 80, max: 101, color: 'var(--accent-green)' },
      { label: '60–79', min: 60, max: 80, color: 'var(--accent-teal)' },
      { label: '40–59', min: 40, max: 60, color: 'var(--accent-orange)' },
      { label: '0–39', min: 0, max: 40, color: 'var(--danger)' },
    ].map((b) => ({ ...b, count: leads.filter((l) => l.leadScore >= b.min && l.leadScore < b.max).length }));

    const avgScore = Math.round(leads.reduce((sum, l) => sum + l.leadScore, 0) / leads.length);

    const statusCount = new Map<string, number>();
    for (const lead of leads) {
      statusCount.set(lead.status, (statusCount.get(lead.status) || 0) + 1);
    }

    const byCategory = new Map<string, number>();
    for (const lead of leads) {
      byCategory.set(lead.category, (byCategory.get(lead.category) || 0) + 1);
    }
    const topCategories = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return { withEmail, withPhone, withForm, withAny, topTech, buckets, avgScore, total: leads.length, statusCount, topCategories };
  }, [leads]);

  const runStats = useMemo(() => {
    if (runs.length === 0) return null;
    const completed = runs.filter((r) => r.status === 'completed').length;
    const stopped = runs.filter((r) => r.status === 'stopped').length;
    const failed = runs.filter((r) => r.status === 'failed').length;
    const totalLeads = runs.reduce((sum, r) => sum + r.stats.leads, 0);
    const totalScanned = runs.reduce((sum, r) => sum + r.stats.scanned, 0);
    const modelUsage = new Map<string, number>();
    for (const r of runs) {
      const key = [r.provider || '—', r.model || '—'].filter(Boolean).join(' · ');
      modelUsage.set(key, (modelUsage.get(key) || 0) + 1);
    }
    const topModels = Array.from(modelUsage.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return { total: runs.length, completed, stopped, failed, totalLeads, totalScanned, topModels };
  }, [runs]);

  if (!stats) {
    return (
      <div className="lg-empty">
        <div className="lg-empty-title">Статистики ще немає</div>
        <p>Запустіть першу кампанію на вкладці «Пошук» — тут з’явиться зведення.</p>
      </div>
    );
  }

  const pct = (n: number) => Math.round((n / stats.total) * 100);

  return (
    <div className="lg-page">
      <div className="lg-dash-grid">
        <div className="lg-dash-stat">
          <span className="lg-dash-stat-value">{stats.total}</span>
          <span className="lg-dash-stat-label">Лідів у вибірці</span>
        </div>
        <div className="lg-dash-stat">
          <span className="lg-dash-stat-value">{stats.avgScore}</span>
          <span className="lg-dash-stat-label">Середній скор</span>
        </div>
        <div className="lg-dash-stat">
          <span className="lg-dash-stat-value">{pct(stats.withEmail)}%</span>
          <span className="lg-dash-stat-label">З email ({stats.withEmail})</span>
        </div>
        <div className="lg-dash-stat">
          <span className="lg-dash-stat-value">{pct(stats.withPhone)}%</span>
          <span className="lg-dash-stat-label">З телефоном ({stats.withPhone})</span>
        </div>
        <div className="lg-dash-stat">
          <span className="lg-dash-stat-value">{pct(stats.withForm)}%</span>
          <span className="lg-dash-stat-label">З contact-формою ({stats.withForm})</span>
        </div>
        <div className="lg-dash-stat">
          <span className="lg-dash-stat-value">{pct(stats.withAny)}%</span>
          <span className="lg-dash-stat-label">Є контакт будь-який</span>
        </div>
      </div>

      <div className="lg-stats-columns">
        <div className="lg-card">
          <h3 className="lg-section-title">Розподіл скорів</h3>
          {stats.buckets.map((b) => (
            <div key={b.label} className="lg-score-row">
              <span className="lg-score-row-label">{b.label}</span>
              <div className="lg-score-row-bar">
                <div className="lg-score-row-bar-fill" style={{ width: `${(b.count / stats.total) * 100}%`, background: b.color }} />
              </div>
              <span className="lg-score-row-value">{b.count}</span>
            </div>
          ))}

          <h3 className="lg-section-title" style={{ marginTop: 18 }}>Статуси лідів</h3>
          <div className="lg-chip-row">
            {Array.from(stats.statusCount.entries()).map(([status, count]) => (
              <span key={status} className={`lg-badge lg-badge--${status}`}>
                {status}: {count}
              </span>
            ))}
          </div>

          {stats.topCategories.length > 0 && (
            <>
              <h3 className="lg-section-title" style={{ marginTop: 18 }}>Топ ніш (категорій)</h3>
              <div className="lg-chip-row">
                {stats.topCategories.map(([cat, count]) => (
                  <span key={cat} className="lg-chip">
                    {cat} · {count}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="lg-card">
          <h3 className="lg-section-title">Топ-технології на сайтах</h3>
          <div className="lg-chip-row">
            {stats.topTech.map(([tech, count]) => (
              <span key={tech} className="lg-chip">
                {tech} · {count}
              </span>
            ))}
            {stats.topTech.length === 0 && <span className="lg-hint">Не виявлено</span>}
          </div>

          {runStats && (
            <>
              <h3 className="lg-section-title" style={{ marginTop: 18 }}>Кампанії</h3>
              <div className="lg-dash-grid">
                <div className="lg-dash-stat">
                  <span className="lg-dash-stat-value">{runStats.total}</span>
                  <span className="lg-dash-stat-label">Всього кампаній</span>
                </div>
                <div className="lg-dash-stat">
                  <span className="lg-dash-stat-value">{runStats.completed}</span>
                  <span className="lg-dash-stat-label">Завершено</span>
                </div>
                <div className="lg-dash-stat">
                  <span className="lg-dash-stat-value">{runStats.stopped}</span>
                  <span className="lg-dash-stat-label">Зупинено</span>
                </div>
                <div className="lg-dash-stat">
                  <span className="lg-dash-stat-value">{runStats.failed}</span>
                  <span className="lg-dash-stat-label">З помилкою</span>
                </div>
                <div className="lg-dash-stat">
                  <span className="lg-dash-stat-value">{runStats.totalLeads}</span>
                  <span className="lg-dash-stat-label">Лідів знайдено</span>
                </div>
                <div className="lg-dash-stat">
                  <span className="lg-dash-stat-value">{runStats.totalScanned}</span>
                  <span className="lg-dash-stat-label">Сайтів проскановано</span>
                </div>
              </div>

              <h3 className="lg-section-title" style={{ marginTop: 18 }}>Використані провайдери/моделі</h3>
              <div className="lg-chip-row">
                {runStats.topModels.map(([key, count]) => (
                  <span key={key} className="lg-chip">
                    {key} · {count}×
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
