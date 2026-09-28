'use client';
import { useState, useEffect } from 'react';
import type { Saving } from '@/types';
import { BANKS } from '@/lib/banks';
import { today, displayCurrency, currencySymbol } from '@/lib/utils';
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
  const [currency, setCurrency] = useState('UAH');
  const [date, setDate] = useState('');

  useEffect(() => {
    if (saving) {
      setName(saving.name || '');
      setBank(saving.bank || '');
      setAmount(String(saving.amount || ''));
      setGoal(String(saving.goal || ''));
      setCurrency(saving.currency || 'UAH');
      setDate(saving.date || '');
    } else {
      setName(''); setBank(''); setAmount(''); setGoal(''); setCurrency(displayCurrency()); setDate(today());
    }
  }, [saving, isOpen]);

  const handleSave = () => {
    onSave({ name, bank, amount: Number(amount) || 0, goal: Number(goal) || 0, currency, date });
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
          <select className="form-input" value={bank} onChange={e => setBank(e.target.value)}>
            <option value="">Оберіть банк / гаманець</option>
            {BANKS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Валюта *</label>
          <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
            <option value="UAH">₴ Гривня</option>
            <option value="USD">$ Долар</option>
            <option value="EUR">€ Євро</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Дата</label>
          <input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Наразі ({currencySymbol(currency)})</label>
          <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">Ціль ({currencySymbol(currency)}) *</label>
          <input type="number" className="form-input" value={goal} onChange={e => setGoal(e.target.value)} min="0" placeholder="0" />
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={handleSave} />
    </Modal>
  );
}
