'use client';
import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';
import { formatDate } from '@/lib/utils';
import { savePlannedProject, deletePlannedProject } from '@/lib/actions';
import { emitToast } from '@/lib/toast-bus';
import ConfirmModal from '@/components/ui/ConfirmModal';
import RowActionButton from '@/components/ui/RowActionButton';
import { useConfirm } from '@/hooks/useConfirm';
import PlannedProjectForm from '@/components/planned/PlannedProjectForm';
import type { PlannedProject } from '@/types';

// ============================================================
// Пакет 06: сторінка «Заплановані проєкти» — заявки на майбутні
// проєкти. Без фінансових полів, статусів, дат оплат і нагадувань.
// Категорії: IT / Design / Video. Жодних автоматичних транзакцій
// «Фінансів» і зв'язку з активними проєктами.
// ============================================================

const CATEGORIES = ['IT', 'Design', 'Video'] as const;
const CATEGORY_BADGE: Record<string, string> = { IT: 'badge--blue', Design: 'badge--purple', Video: 'badge--orange' };

export default function PlannedProjectsPage() {
  const { snapshot, writeBlock, unsupportedCollections, triggerRefresh } = useApp();
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editProject, setEditProject] = useState<PlannedProject | null>(null);
  const [expandedId, setExpandedId] = useState('');
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();

  // Рев'ю P1: захист від undefined (старий сервер) — контракт datasource уже
  // повертає порожній масив, тут лише додаткова оборона проти crash.
  const planned = useMemo(() => snapshot.plannedProjects ?? [], [snapshot.plannedProjects]);
  // Стара БД без міграцій 004–006: розділ показує стан недоступності,
  // дії запису вимкнені (запис і так заблоковано на рівні джерела даних).
  const sectionUnsupported = unsupportedCollections !== null;

  const rows = useMemo(() => {
    const q = query.toLowerCase().trim();
    return planned.filter(p => {
      if (categoryFilter && p.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.clientName || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
    });
  }, [planned, query, categoryFilter]);

  const reportErrors = (errors: { message: string }[]) => {
    emitToast(errors.map(e => e.message).join('; '), 'error');
  };

  const handleSave = async (data: Partial<PlannedProject>) => {
    const result = await savePlannedProject(data as never, editProject?.id);
    if (!result.ok) { reportErrors(result.errors); return; }
    setFormOpen(false);
    setEditProject(null);
    triggerRefresh();
  };

  const handleDelete = (project: PlannedProject) => {
    confirm(
      `Видалити «${project.name}»?`,
      'Запланований проєкт буде видалено. Дія потрапить в історію змін і може бути скасована там.',
      () => {
        void (async () => {
          const result = await deletePlannedProject(project.id);
          if (!result.ok) { reportErrors(result.errors); return; }
          triggerRefresh();
        })();
      },
    );
  };

  const openAdd = () => { setEditProject(null); setFormOpen(true); };
  const openEdit = (project: PlannedProject) => { setEditProject(project); setFormOpen(true); };

  return (
    <section className="page active">
      <div className="page-header">
        <div>
          <h1 className="page-title">Заплановані проєкти</h1>
          <p className="page-subtitle">Заявки на майбутні проєкти без фінансових полів і нагадувань</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={openAdd} disabled={sectionUnsupported}>Додати проєкт</button>
        </div>
      </div>

      {sectionUnsupported ? (
        <div className="settings-text" role="status">
          <p style={{ marginTop: 0 }}>
            Розділ «Заплановані проєкти» тимчасово недоступний: підключена база ще не підтримує нові колекції.
            Наявні дані не втрачено, запис заблоковано до застосування міграцій.
          </p>
          {writeBlock && <p>{writeBlock}</p>}
        </div>
      ) : (
      <>
      <div className="table-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <input
          type="search"
          className="form-input"
          style={{ maxWidth: 260 }}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Пошук: назва, клієнт, опис"
          aria-label="Пошук запланованих проєктів"
        />
        <select
          className="form-input"
          style={{ maxWidth: 180 }}
          value={categoryFilter}
          onChange={e => setCategoryFilter(e.target.value)}
          aria-label="Фільтр за категорією"
        >
          <option value="">Усі категорії</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {rows.length === 0 && (
        <p className="settings-text">
          {planned.length === 0
            ? 'Запланованих проєктів ще немає. Натисніть «Додати проєкт».'
            : 'За обраними фільтрами нічого не знайдено.'}
        </p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Проєкт</th>
                <th>Категорія</th>
                <th>Клієнт</th>
                <th>Створено</th>
                <th aria-label="Дії" />
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} className={expandedId === p.id ? 'planned-expanded' : undefined}>
                  <td data-label="Проєкт" className="cell-name">
                    <strong>{p.name}</strong>
                    {p.description && (
                      <div className="cell-secondary planned-desc">{p.description}</div>
                    )}
                  </td>
                  <td data-label="Категорія">
                    <span className={`badge ${CATEGORY_BADGE[p.category] || 'badge--gray'}`}>{p.category}</span>
                  </td>
                  <td data-label="Клієнт">
                    {p.clientName || '—'}
                    {p.clientId && <div className="cell-secondary">з картки клієнта</div>}
                  </td>
                  <td data-label="Створено" className="cell-nowrap">
                    {p.createdAt ? formatDate(p.createdAt) : '—'}
                  </td>
                  <td data-label="Дії">
                    <div className="text-row-actions">
                      {p.description && (
                        <RowActionButton
                          icon={expandedId === p.id ? 'collapse' : 'expand'}
                          className="planned-more"
                          aria-expanded={expandedId === p.id}
                          onClick={() => setExpandedId(expandedId === p.id ? '' : p.id)}
                        >
                          {expandedId === p.id ? 'Приховати' : 'Детальніше'}
                        </RowActionButton>
                      )}
                      <RowActionButton icon="edit" tone="edit" onClick={() => openEdit(p)}>Редагувати</RowActionButton>
                      <RowActionButton icon="delete" tone="danger" onClick={() => handleDelete(p)}>Видалити</RowActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>
      )}

      <PlannedProjectForm
        isOpen={formOpen}
        project={editProject}
        onSave={handleSave}
        onCancel={() => { setFormOpen(false); setEditProject(null); }}
      />

      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
  );
}
