'use client';

import { useState } from 'react';
import { Lead, LeadStatus } from '@/lib/lead-generator/types';
import { ScorePill, STATUS_OPTIONS } from './LeadsTable';

interface Props {
  lead: Lead;
  onClose: () => void;
  onStatusChange: (lead: Lead, status: LeadStatus) => void;
  onNotesChange: (lead: Lead, notes: string) => void;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="lg-copy-btn"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      title="Копіювати"
    >
      {copied ? '✓' : label || 'Копіювати'}
    </button>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? 'var(--accent-green)' : value >= 40 ? 'var(--accent-orange)' : 'var(--danger)';
  return (
    <div className="lg-score-row">
      <span className="lg-score-row-label">{label}</span>
      <div className="lg-score-row-bar">
        <div className="lg-score-row-bar-fill" style={{ width: `${Math.min(100, value)}%`, background: color }} />
      </div>
      <span className="lg-score-row-value">{Math.round(value)}</span>
    </div>
  );
}

export default function LeadDetailModal({ lead, onClose, onStatusChange, onNotesChange }: Props) {
  const [notes, setNotes] = useState(lead.notes || '');

  let analysisPretty = lead.aiAnalysis;
  try {
    analysisPretty = JSON.stringify(JSON.parse(lead.aiAnalysis), null, 2);
  } catch {
    // raw
  }

  const analysis: {
    problems?: string[];
    potentialValue?: string;
    recommendation?: string;
    reason?: string;
  } = (() => {
    try {
      return JSON.parse(lead.aiAnalysis);
    } catch {
      return {};
    }
  })();

  return (
    <div className="lg-modal-overlay" onClick={onClose}>
      <div className="lg-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lg-modal-header">
          <div>
            <h2 className="lg-modal-title">{lead.companyName}</h2>
            <span className="lg-hint">{lead.domain}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ScorePill score={lead.leadScore} />
            <button className="lg-modal-close" onClick={onClose} aria-label="Закрити">
              ×
            </button>
          </div>
        </div>

        <div className="lg-modal-body">
          <div className="lg-section lg-kv-grid">
            <div>
              <span className="lg-kv-label">Сайт</span>
              <span className="lg-kv-value">
                <a className="lg-link" href={lead.website} target="_blank" rel="noopener noreferrer">
                  {lead.website}
                </a>
              </span>
            </div>
            <div>
              <span className="lg-kv-label">Локація / Ніша</span>
              <span className="lg-kv-value">
                {lead.location} · {lead.category}
              </span>
            </div>
            <div>
              <span className="lg-kv-label">Кампанія</span>
              <span className="lg-kv-value">#{lead.runId ?? '—'}</span>
            </div>
            <div>
              <span className="lg-kv-label">Статус</span>
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
            </div>
          </div>

          <div className="lg-section">
            <h3 className="lg-section-title">Розбір скору</h3>
            <ScoreRow label="Ніша" value={lead.matchScore} />
            <ScoreRow label="Локація" value={lead.locationScore} />
            <ScoreRow label="Контакти" value={lead.contactScore} />
            <ScoreRow label="Якість сайту" value={lead.qualityScore} />
            <ScoreRow label="AI" value={lead.aiScore} />
            <ScoreRow label="Проблеми" value={lead.problemsScore} />
          </div>

          <div className="lg-section">
            <h3 className="lg-section-title">Контакти</h3>
            {lead.emails.length > 0 && (
              <div className="lg-contact-row">
                <span className="lg-kv-label" style={{ marginBottom: 0 }}>Email:</span>
                {lead.emails.map((email) => {
                  const verified = lead.verifiedEmails.includes(email);
                  return (
                    <span key={email} className="lg-chip">
                      <a className="lg-link" href={`mailto:${email}`}>
                        {email}
                      </a>
                      {verified ? ' ✓' : ''}
                      <CopyButton text={email} label="⧉" />
                    </span>
                  );
                })}
              </div>
            )}
            {lead.phones.length > 0 && (
              <div className="lg-contact-row">
                <span className="lg-kv-label" style={{ marginBottom: 0 }}>Телефон:</span>
                {lead.phones.map((phone) => (
                  <span key={phone} className="lg-chip">
                    <a className="lg-link" href={`tel:${phone}`}>
                      {phone}
                    </a>
                    <CopyButton text={phone} label="⧉" />
                  </span>
                ))}
              </div>
            )}
            {lead.addresses.length > 0 && (
              <div className="lg-contact-row">
                <span className="lg-kv-label" style={{ marginBottom: 0 }}>Адреса:</span>
                <span className="lg-kv-value">{lead.addresses.join(', ')}</span>
              </div>
            )}
            {lead.socialLinks.length > 0 && (
              <div className="lg-contact-row">
                <span className="lg-kv-label" style={{ marginBottom: 0 }}>Соцмережі:</span>
                {lead.socialLinks.map((link) => (
                  <a key={link} className="lg-link" style={{ marginRight: 10, fontSize: '0.85rem' }} href={link} target="_blank" rel="noopener noreferrer">
                    {(() => {
                      try {
                        return new URL(link).hostname.replace(/^www\./, '');
                      } catch {
                        return link;
                      }
                    })()}
                  </a>
                ))}
              </div>
            )}
            {lead.emails.length === 0 && lead.phones.length === 0 && lead.addresses.length === 0 && (
              <span className="lg-hint">Контакти не знайдено</span>
            )}
          </div>

          <div className="lg-section">
            <h3 className="lg-section-title">Ознаки сайту</h3>
            <div className="lg-chip-row">
              {lead.hasContactForm && <span className="lg-chip">Contact Form</span>}
              {lead.hasBooking && <span className="lg-chip">Booking</span>}
              {lead.hasCTA && <span className="lg-chip">CTA</span>}
              {lead.technologies.map((tech) => (
                <span key={tech} className="lg-chip">
                  {tech}
                </span>
              ))}
            </div>
          </div>

          {lead.businessSummary && (
            <div className="lg-section">
              <h3 className="lg-section-title">Опис бізнесу (AI)</h3>
              <div className="lg-summary-box">{lead.businessSummary}</div>
            </div>
          )}

          {analysisPretty && analysisPretty !== '{}' && (
            <div className="lg-section">
              <h3 className="lg-section-title">AI-аналіз</h3>
              {analysis.reason && <div className="lg-summary-box" style={{ marginBottom: 10 }}>{analysis.reason}</div>}
              {analysis.problems && analysis.problems.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <span className="lg-kv-label">Проблеми:</span>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
                    {analysis.problems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              {analysis.potentialValue && (
                <div className="lg-summary-box" style={{ marginBottom: 10 }}>
                  <span className="lg-kv-label">Потенціал:</span> {analysis.potentialValue}
                </div>
              )}
              {analysis.recommendation && (
                <div className="lg-summary-box">
                  <span className="lg-kv-label">Рекомендація:</span> {analysis.recommendation}
                </div>
              )}
              {!analysis.reason && !analysis.problems && !analysis.potentialValue && !analysis.recommendation && (
                <pre className="lg-pre">{analysisPretty}</pre>
              )}
            </div>
          )}

          {lead.screenshotPath && (
            <div className="lg-section">
              <h3 className="lg-section-title">Скріншот сайту</h3>
              <img
                className="lg-screenshot"
                src={`/api/lead-generator/leads/${lead.id}/screenshot`}
                alt={`Скріншот ${lead.domain}`}
                loading="lazy"
              />
            </div>
          )}

          <div className="lg-section">
            <h3 className="lg-section-title">Нотатки</h3>
            <textarea
              className="lg-textarea lg-notes-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (lead.notes || '') && onNotesChange(lead, notes)}
              placeholder="Додати нотатку до ліда…"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
