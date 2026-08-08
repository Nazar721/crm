'use client';
import { useState, useEffect } from 'react';
import type { PersonalDebt } from '@/types';
import { today } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';

interface DebtFormProps {
  isOpen: boolean;
  debt?: PersonalDebt | null;
  initialType?: 'owed_to_me' | 'my_debt';
  onSave: (data: Partial<PersonalDebt>) => void;
  onCancel: () => void;
}

export default function DebtForm({ isOpen, debt, initialType = 'owed_to_me', onSave, onCancel }: DebtFormProps) {
  const [type, setType] = useState<'owed_to_me' | 'my_debt'>(initialType);
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    if (debt) {
      setType(debt.type);
      setPerson(debt.person || '');
      setAmount(String(debt.amount || ''));
      setNote(debt.note || '');
      setDate(debt.date || '');
    } else {
      setType(initialType);
      setPerson(''); setAmount(''); setNote(''); setDate(today());
    }
  }, [debt, isOpen, initialType]);

  const handleSave = () => {
    onSave({ type, person, amount: Number(amount) || 0, note, date });
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={debt ? 'Редагувати борг' : (type === 'owed_to_me' ? 'Новий борг мені' : 'Новий мій борг')}>
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Тип *</label>
          <select className="form-input" value={type} onChange={e => setType(e.target.value as 'owed_to_me' | 'my_debt')}>
            <option value="owed_to_me">Борг мені</option>
            <option value="my_debt">Мій борг</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Сума (₴) *</label>
          <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} min="0" />
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Хто / Кому *</label>
          <input type="text" className="form-input" value={person} onChange={e => setPerson(e.target.value)} placeholder="Ім&apos;я, компанія..." />
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Примітка</label>
          <input type="text" className="form-input" value={note} onChange={e => setNote(e.target.value)} placeholder="За що, деталі..." />
        </div>
        <div className="form-group">
          <label className="form-label">Дата</label>
          <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={handleSave} />
    </Modal>
  );
}
