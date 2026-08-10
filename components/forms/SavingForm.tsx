'use client';
import { useState, useEffect } from 'react';
import type { Saving } from '@/types';
import { BANKS } from '@/lib/banks';
import { today } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';

interface SavingFormProps {
  isOpen: boolean;
  saving?: Saving | null;
  onSave: (data: Partial<Saving>) => void;
  onCancel: () => void;
}

export default function SavingForm({ isOpen, saving, onSave, onCancel }: SavingFormProps) {
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [amount, setAmount] = useState('');
  const [goal, setGoal] = useState('');
  const [date, setDate] = useState('');

  useEffect(() => {
    if (saving) {
      setName(saving.name || '');
      setBank(saving.bank || '');
      setAmount(String(saving.amount || ''));
      setGoal(String(saving.goal || ''));
      setDate(saving.date || '');
    } else {
      setName(''); setBank(''); setAmount(''); setGoal(''); setDate(today());
    }
  }, [saving, isOpen]);

  const handleSave = () => {
    onSave({ name, bank, amount: Number(amount) || 0, goal: Number(goal) || 0, date });
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={saving ? 'Редагувати відкладення' : 'Нове відкладення'}>
      <div className="form-grid">
        <div className="form-group form-group--full">
          <label className="form-label">Назва цілі</label>
          <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="MacBook, подушка безпеки..." />
        </div>
        <div className="form-group">
          <label className="form-label">Банк *</label>
          <input list="saving-bank-list" type="text" className="form-input" value={bank} onChange={e => setBank(e.target.value)} placeholder="Назва банку" />
          <datalist id="saving-bank-list">
            {BANKS.map(b => <option key={b.id} value={b.label} />)}
          </datalist>
        </div>
        <div className="form-group">
          <label className="form-label">Дата</label>
          <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Наразі (₴)</label>
          <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">Ціль (₴) *</label>
          <input type="number" className="form-input" value={goal} onChange={e => setGoal(e.target.value)} min="0" placeholder="0" />
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={handleSave} />
    </Modal>
  );
}
