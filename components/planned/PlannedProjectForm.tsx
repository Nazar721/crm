'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { PlannedProject, Client } from '@/types';
import { getClients } from '@/lib/storage';

import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';
import AutocompleteInput from '@/components/ui/AutocompleteInput';

interface PlannedProjectFormProps {
  isOpen: boolean;
  project?: PlannedProject | null;
  onSave: (data: Partial<PlannedProject>) => void | Promise<void>;
  onCancel: () => void;
}

// Форма запланованого проєкту: назва, категорія, клієнт, опис і необов’язкова дата.
// Клієнт: autocomplete із чинних карток або ручне ім'я. Ручне введення НЕ
// створює картку клієнта і не лінкується за іменем; clientId зберігається лише
// за явного вибору зі списку (selectedClientId, патерн ProjectForm).
export default function PlannedProjectForm({ isOpen, project, onSave, onCancel }: PlannedProjectFormProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('IT');
  const [clientName, setClientName] = useState('');
  const [description, setDescription] = useState('');
  const [plannedDate, setPlannedDate] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (project) {
      setName(project.name || '');
      setCategory(project.category || 'IT');
      setClientName(project.clientName || '');
      setDescription(project.description || '');
      setPlannedDate(project.plannedDate || '');
      setSelectedClientId(project.clientId || '');
    } else {
      setName('');
      setCategory('IT');
      setClientName('');
      setDescription('');
      setPlannedDate('');
      setSelectedClientId('');
    }
  }, [project, isOpen]);

  const clientOptions = useMemo(() => {
    return getClients().map(c => ({
      value: c.name,
      hint: c.telegram || undefined,
      badge: c.isRegular ? 'Постійний' : undefined,
      data: c,
    }));
  }, [isOpen]);

  const handleClientNameChange = (val: string) => {
    setClientName(val);
    setSelectedClientId('');
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        category: category as PlannedProject['category'],
        clientName: clientName.trim(),
        description: description.trim() || undefined,
        plannedDate,
        clientId: selectedClientId || undefined,
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={project ? 'Редагувати запланований проєкт' : 'Новий запланований проєкт'} size="md" onSubmit={handleSave}>
      <div className="form-grid">
        <div className="form-group form-group--full">
          <label className="form-label">Назва проєкту *</label>
          <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Наприклад: Сайт для квіткової крамниці" />
        </div>
        <div className="form-group">
          <label className="form-label">Категорія *</label>
          <select className="form-input" value={category} onChange={e => setCategory(e.target.value)}>
            <option value="IT">IT</option>
            <option value="Design">Design</option>
            <option value="Video">Video</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Клієнт *</label>
          <AutocompleteInput
            value={clientName}
            onChange={handleClientNameChange}
            options={clientOptions}
            onSelect={opt => {
              const c = opt.data as Client;
              if (!c) return;
              setSelectedClientId(c.id);
            }}
            placeholder="Почніть вводити ім'я..."
            filter={(opt, q) =>
              opt.value.toLowerCase().includes(q) ||
              (String((opt.data as Client)?.telegram || '')).toLowerCase().includes(q)
            }
          />
          {selectedClientId && (
            <p className="settings-text" style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: 4, marginBottom: 0 }}>
              Пов&apos;язано з карткою клієнта. Ручне ім&apos;я не створює картку автоматично.
            </p>
          )}
        </div>
        <div className="form-group form-group--full">
          <label className="form-label" htmlFor="planned-project-date">Запланована дата</label>
          <input id="planned-project-date" type="date" className="form-input" value={plannedDate} onChange={e => setPlannedDate(e.target.value)} />
          <small className="form-hint">Індикатор у меню з’явиться за 2 дні до цієї дати.</small>
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Опис</label>
          <textarea className="form-input" rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Короткий опис майбутнього проєкту" />
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={() => void handleSave()} saveLabel={project ? 'Зберегти' : 'Додати'} disabled={saving} />
    </Modal>
  );
}
