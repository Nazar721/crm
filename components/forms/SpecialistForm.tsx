'use client';
import { useState, useEffect } from 'react';
import type { Specialist } from '@/types';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';
import { validateSpecialistInput } from '@/lib/actions';
import { DEFAULT_MY_SHARE } from '@/lib/my-share';
import { emitToast } from '@/lib/toast-bus';

export interface SpecialistFormData {
  name: string;
  specialization: string;
  telegram: string;
  myShareThreshold: string;
  mySharePercentUpTo: string;
  mySharePercentAbove: string;
}

interface SpecialistFormProps {
  isOpen: boolean;
  specialist?: Specialist | null;
  onSave: (data: SpecialistFormData) => void;
  onCancel: () => void;
}

export default function SpecialistForm({ isOpen, specialist, onSave, onCancel }: SpecialistFormProps) {
  const [name, setName] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [telegram, setTelegram] = useState('');
  const [myShareThreshold, setMyShareThreshold] = useState(String(DEFAULT_MY_SHARE.threshold));
  const [mySharePercentUpTo, setMySharePercentUpTo] = useState(String(DEFAULT_MY_SHARE.percentUpTo));
  const [mySharePercentAbove, setMySharePercentAbove] = useState(String(DEFAULT_MY_SHARE.percentAbove));

  useEffect(() => {
    if (specialist) {
      setName(specialist.name || '');
      setSpecialization(specialist.specialization || '');
      setTelegram(specialist.telegram || '');
      // Старі записи без налаштувань показують початкове правило.
      setMyShareThreshold(String(specialist.myShareThreshold ?? DEFAULT_MY_SHARE.threshold));
      setMySharePercentUpTo(String(specialist.mySharePercentUpTo ?? DEFAULT_MY_SHARE.percentUpTo));
      setMySharePercentAbove(String(specialist.mySharePercentAbove ?? DEFAULT_MY_SHARE.percentAbove));
    } else {
      setName(''); setSpecialization(''); setTelegram('');
      setMyShareThreshold(String(DEFAULT_MY_SHARE.threshold));
      setMySharePercentUpTo(String(DEFAULT_MY_SHARE.percentUpTo));
      setMySharePercentAbove(String(DEFAULT_MY_SHARE.percentAbove));
    }
  }, [specialist, isOpen]);

  const handleSave = () => {
    const data: SpecialistFormData = {
      name, specialization, telegram,
      myShareThreshold, mySharePercentUpTo, mySharePercentAbove,
    };
    // Локальна перевірка до запису; та сама перевірка ще раз виконується
    // в доменній дії (saveSpecialist).
    const errors = validateSpecialistInput(data);
    if (errors.length) {
      emitToast(errors.map(e => e.message).join('; '), 'error');
      return;
    }
    onSave(data);
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
        <div className="form-group form-group--full">
          <label className="form-label">Моя частка</label>
          <small className="form-hint">
            Правило автоматичного «Мого відсотка» у проєкті: бюджет до порогу включно → перший відсоток, понад поріг → другий.
          </small>
        </div>
        <div className="form-group">
          <label className="form-label">Поріг бюджету, грн *</label>
          <input
            type="number" className="form-input" value={myShareThreshold}
            onChange={e => setMyShareThreshold(e.target.value)} min="0" step="any" placeholder="3000"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Відсоток до порогу включно, % *</label>
          <input
            type="number" className="form-input" value={mySharePercentUpTo}
            onChange={e => setMySharePercentUpTo(e.target.value)} min="0" max="100" step="any" placeholder="30"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Відсоток понад поріг, % *</label>
          <input
            type="number" className="form-input" value={mySharePercentAbove}
            onChange={e => setMySharePercentAbove(e.target.value)} min="0" max="100" step="any" placeholder="25"
          />
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={handleSave} />
    </Modal>
  );
}
