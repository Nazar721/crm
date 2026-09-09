'use client';

import { useMemo } from 'react';
import { Lead, LeadStatus } from '@/lib/lead-generator/types';

export const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'Новий' },
  { value: 'in-progress', label: 'В роботі' },
  { value: 'contacted', label: 'Контакт' },
  { value: 'won', label: 'Виграний' },
  { value: 'excluded', label: 'Виключений' },
];

interface Props {
  leads: Lead[];
  sortField: keyof Lead;
  sortDir: 'asc' | 'desc';
  onSort: (field: keyof Lead) => void;
  onSelect: (lead: Lead) => void;
  onStatusChange: (lead: Lead, status: LeadStatus) => void;
}

export function ScorePill({ score }: { score: number }) {
  const cls = score >= 70 ? 'lg-score-pill--high' : score >= 40 ? 'lg-score-pill--mid' : 'lg-score-pill--low';
  return <span className={`lg-score-pill ${cls}`}>{score}</span>;
}

export default function LeadsTable({
  leads,
  sortField,
  sortDir,
  onSort,
  onSelect,
  onStatusChange,
}: Props) {
  const columns: { key: keyof Lead; label: string }[] = useMemo(
    () => [
      { key: 'companyName', label: 'Компанія' },
      { key: 'domain', label: 'Домен' },
      { key: 'emails', label: 'Email' },
      { key: 'phones', label: 'Телефон' },
      { key: 'leadScore', label: 'Скор' },
      { key: 'status', label: 'Статус' },
    ],
    []
  );

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className="lg-table-wrap anim-stagger">
      <div className="lg-table-scroll">
        <table className="lg-table">
          <thead>
            <tr>
              {columns.map(({ key, label }) => (
                <th key={String(key)} onClick={() => onSort(key)}>
                  {label}
                  {sortField === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id} onClick={() => onSelect(lead)}>
                <td className="lg-company" title={lead.companyName}>
                  {lead.companyName}
                </td>
                <td>{lead.domain}</td>
                <td>{lead.emails[0] || '—'}</td>
                <td>{lead.phones[0] || '—'}</td>
                <td>
                  <ScorePill score={lead.leadScore} />
                </td>
                <td onClick={stopPropagation}>
                  <select
                    className={`lg-select lg-status-select lg-badge lg-badge--${lead.status}`}
                    value={lead.status}
                    onChange={(e) => onStatusChange(lead, e.target.value as LeadStatus)}
                  >
                    {STATUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
