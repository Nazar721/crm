'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import './lg.css';
import { Lead, LeadStatus, PipelineConfig, Run, ProviderId } from '@/lib/lead-generator/types';
import { usePipeline } from '@/hooks/lead-generator/usePipeline';
import ConfigForm from '@/components/lead-generator/ConfigForm';
import ProgressPanel from '@/components/lead-generator/ProgressPanel';
import RunsList from '@/components/lead-generator/RunsList';
import LeadsTable from '@/components/lead-generator/LeadsTable';
import LeadDetailModal from '@/components/lead-generator/LeadDetailModal';
import StatsPanel from '@/components/lead-generator/StatsPanel';
import SettingsPanel from '@/components/lead-generator/SettingsPanel';

type Tab = 'search' | 'results' | 'stats' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'search', label: 'Пошук' },
  { id: 'results', label: 'Результати' },
  { id: 'stats', label: 'Статистика' },
  { id: 'settings', label: 'Налаштування' },
];

const DEFAULT_CONFIG: PipelineConfig = {
  niche: '',
  location: '',
  keywords: '',
  maxResults: 50,
  additionalCriteria: '',
  concurrency: 4,
  useAI: true,
  provider: '',
  model: '',
};

function TabButton({
  id,
  label,
  activeTab,
  badge,
  onSelect,
}: {
  id: Tab;
  label: string;
  activeTab: Tab;
  badge?: number;
  onSelect: (tab: Tab) => void;
}) {
  return (
    <button
      className={`lg-tab${activeTab === id ? ' lg-tab--active' : ''}`}
      onClick={() => onSelect(id)}
      type="button"
    >
      {label}
      {badge !== undefined && badge > 0 && <span className="lg-tab-badge">{badge}</span>}
    </button>
  );
}

export default function LeadGeneratorPage() {
  const [tab, setTab] = useState<Tab>('search');
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [filterScore, setFilterScore] = useState(0);
  const [filterEmail, setFilterEmail] = useState(false);
  const [filterPhone, setFilterPhone] = useState(false);
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState<keyof Lead>('leadScore');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const loadLeads = useCallback(async (runId: number | null) => {
    try {
      const query = runId !== null ? `?runId=${runId}` : '';
      const res = await fetch(`/api/lead-generator/leads${query}`);
      if (res.ok) setLeads(await res.json());
    } catch {
      // ignore
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/lead-generator/runs');
      if (res.ok) setRuns(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadLeads(null);
    loadRuns();
  }, [loadLeads, loadRuns]);

  const handleCompleted = useCallback(
    (runId: number) => {
      setActiveRunId(runId);
      loadLeads(runId);
      loadRuns();
      setTab('results');
    },
    [loadLeads, loadRuns]
  );

  const { state, start, stop } = usePipeline(handleCompleted);

  const handleStart = () => {
    setLeads([]);
    setSelectedLead(null);
    start(config);
  };

  const handleStatusChange = async (lead: Lead, status: LeadStatus) => {
    try {
      const res = await fetch(`/api/lead-generator/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated: Lead = await res.json();
        setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        if (selectedLead?.id === updated.id) setSelectedLead(updated);
      }
    } catch {
      // ignore
    }
  };

  const handleNotesChange = async (lead: Lead, notes: string) => {
    try {
      const res = await fetch(`/api/lead-generator/leads/${lead.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      if (res.ok) {
        const updated: Lead = await res.json();
        setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        if (selectedLead?.id === updated.id) setSelectedLead(updated);
      }
    } catch {
      // ignore
    }
  };

  const handleSelectRun = (runId: number | null) => {
    setActiveRunId(runId);
    setSelectedLead(null);
    loadLeads(runId);
  };

  const exportUrl = (format: 'csv' | 'json') =>
    `/api/lead-generator/export?format=${format}${activeRunId !== null ? `&runId=${activeRunId}` : ''}`;

  const filteredLeads = useMemo(
    () =>
      leads
        .filter((l) => l.leadScore >= filterScore)
        .filter((l) => !filterEmail || l.emails.length > 0)
        .filter((l) => !filterPhone || l.phones.length > 0)
        .filter((l) => !filterStatus || l.status === filterStatus)
        .sort((a, b) => {
          const aVal = a[sortField];
          const bVal = b[sortField];
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
          }
          if (Array.isArray(aVal) && Array.isArray(bVal)) {
            return sortDir === 'asc' ? aVal.length - bVal.length : bVal.length - aVal.length;
          }
          return sortDir === 'asc'
            ? String(aVal).localeCompare(String(bVal))
            : String(bVal).localeCompare(String(aVal));
        }),
    [leads, filterScore, filterEmail, filterPhone, filterStatus, sortField, sortDir]
  );

  const toggleSort = (field: keyof Lead) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  return (
    <section className="page active">
      <div className="page-header">
        <div>
          <h1 className="page-title">Lead Generator</h1>
          <p className="page-subtitle">Пошук і кваліфікація потенційних клієнтів — незалежний інструмент</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => window.open(exportUrl('csv'), '_blank')} disabled={leads.length === 0}>
            Export CSV
          </button>
          <button className="btn btn-ghost" onClick={() => window.open(exportUrl('json'), '_blank')} disabled={leads.length === 0}>
            Export JSON
          </button>
        </div>
      </div>

      <div className="lg-tabs" role="tablist">
        {TABS.map((t) => (
          <TabButton
            key={t.id}
            id={t.id}
            label={t.label}
            activeTab={tab}
            badge={t.id === 'results' ? leads.length : undefined}
            onSelect={setTab}
          />
        ))}
      </div>

      <div className="lg-page">
        {tab === 'search' && (
          <>
            <ConfigForm
              config={config}
              onChange={setConfig}
              isRunning={state.isRunning}
              onStart={handleStart}
              onStop={stop}
            />

            {state.error && <div className="lg-alert lg-alert--error">⚠ {state.error}</div>}
            {state.searchBlocked && !state.error && (
              <div className="lg-alert lg-alert--warn">⚠ {state.searchBlocked}</div>
            )}

            <ProgressPanel state={state} />

            <RunsList runs={runs} activeRunId={activeRunId} onSelect={handleSelectRun} />

            {!state.isRunning && !state.stage && runs.length === 0 && (
              <div className="lg-empty">
                <div className="lg-empty-title">Почніть пошук лідів</div>
                <p>
                  Вкажіть нішу та локацію — інструмент знайде сайти, витягне контакти й оцінить потенціал.
                  AI-провайдер і модель налаштовуються у вкладці «Налаштування».
                </p>
              </div>
            )}
          </>
        )}

        {tab === 'results' && (
          <>
            {leads.length === 0 ? (
              <div className="lg-empty">
                <div className="lg-empty-title">Результатів поки немає</div>
                <p>Запустіть кампанію на вкладці «Пошук».</p>
              </div>
            ) : (
              <>
                <div className="lg-toolbar">
                  <h3 className="lg-section-title" style={{ margin: 0 }}>
                    {activeRunId !== null ? `Кампанія #${activeRunId}` : 'Усі кампанії'} ({filteredLeads.length}/{leads.length})
                  </h3>
                  <label className="lg-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    Мін. скор:
                    <input
                      className="lg-input"
                      type="number"
                      min={0}
                      max={100}
                      value={filterScore}
                      onChange={(e) => setFilterScore(Number(e.target.value))}
                      style={{ width: 70 }}
                    />
                  </label>
                  <select
                    className="lg-select lg-status-select"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                  >
                    <option value="">Усі статуси</option>
                    <option value="new">Новий</option>
                    <option value="in-progress">В роботі</option>
                    <option value="contacted">Контакт</option>
                    <option value="won">Виграний</option>
                    <option value="excluded">Виключений</option>
                  </select>
                  <label className="lg-checkbox">
                    <input type="checkbox" checked={filterEmail} onChange={(e) => setFilterEmail(e.target.checked)} />
                    З email
                  </label>
                  <label className="lg-checkbox">
                    <input type="checkbox" checked={filterPhone} onChange={(e) => setFilterPhone(e.target.checked)} />
                    З телефоном
                  </label>
                </div>

                <LeadsTable
                  leads={filteredLeads}
                  sortField={sortField}
                  sortDir={sortDir}
                  onSort={toggleSort}
                  onSelect={setSelectedLead}
                  onStatusChange={handleStatusChange}
                />
              </>
            )}
          </>
        )}

        {tab === 'stats' && <StatsPanel leads={leads} runs={runs} />}

        {tab === 'settings' && <SettingsPanel onSaved={loadRuns} />}
      </div>

      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onStatusChange={handleStatusChange}
          onNotesChange={handleNotesChange}
        />
      )}
    </section>
  );
}
