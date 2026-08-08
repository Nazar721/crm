'use client';
import { useState, useEffect } from 'react';
import type { Specialist } from '@/types';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';

interface SpecialistFormProps {
  isOpen: boolean;
  specialist?: Specialist | null;
  onSave: (data: { name: string; specialization: string; telegram: string }) => void;
  onCancel: () => void;
}

export default function SpecialistForm({ isOpen, specialist, onSave, onCancel }: SpecialistFormProps) {
  const [name, setName] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [telegram, setTelegram] = useState('');

  useEffect(() => {
    if (specialist) {
      setName(specialist.name || '');
      setSpecialization(specialist.specialization || '');
      setTelegram(specialist.telegram || '');
    } else {
      setName(''); setSpecialization(''); setTelegram('');
    }
  }, [specialist, isOpen]);

  const handleSave = () => {
    onSave({ name, specialization, telegram });
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={specialist ? 'Редагувати фахівця' : 'Новий фахівець'}>
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Ім&apos;я *</label>
          <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Спеціалізація *</label>
          <input type="text" className="form-input" value={specialization} onChange={e => setSpecialization(e.target.value)} placeholder="Frontend, Designer..." />
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Telegram / карта</label>
          <input type="text" className="form-input" value={telegram} onChange={e => setTelegram(e.target.value)} placeholder="@username" />
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={handleSave} />
    </Modal>
  );
}
