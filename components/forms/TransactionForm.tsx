'use client';
import { useState, useEffect } from 'react';
import type { Transaction } from '@/types';
import { BANKS } from '@/lib/banks';
import { today } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';

interface TransactionFormProps {
  isOpen: boolean;
  transaction?: Transaction | null;
  initialType?: 'income' | 'expense';
  onSave: (data: Partial<Transaction>) => void;
  onCancel: () => void;
}

export default function TransactionForm({ isOpen, transaction, initialType = 'income', onSave, onCancel }: TransactionFormProps) {
  const [type, setType] = useState<'income' | 'expense'>(initialType);
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [incomeStatus, setIncomeStatus] = useState('earned');

  useEffect(() => {
    if (transaction) {
      setType(transaction.type as 'income' | 'expense');
      setAmount(String(transaction.amount || ''));
      setBank(transaction.bank || '');
      setCategory(transaction.category || '');
      setDescription(transaction.description || '');
      setDate(transaction.date || '');
      setIncomeStatus(transaction.incomeStatus || 'earned');
    } else {
      setType(initialType);
      setAmount(''); setBank(''); setCategory(''); setDescription('');
      setDate(today()); setIncomeStatus('earned');
    }
  }, [transaction, isOpen, initialType]);

  const handleSave = () => {
    onSave({
      type,
      amount: Number(amount) || 0,
      bank,
      category,
      description,
      date,
      status: 'done',
      incomeStatus: type === 'income' ? incomeStatus as 'earned' | 'incoming' : undefined,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={transaction ? 'Редагувати транзакцію' : 'Нова транзакція'}>
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Тип *</label>
          <select className="form-input" value={type} onChange={e => setType(e.target.value as 'income' | 'expense')}>
            <option value="income">Дохід</option>
            <option value="expense">Витрата</option>
          </select>
        </div>
        {type === 'income' && (
          <div className="form-group">
            <label className="form-label">Статус доходу</label>
            <select className="form-input" value={incomeStatus} onChange={e => setIncomeStatus(e.target.value)}>
              <option value="earned">Зароблені</option>
              <option value="incoming">Вхідні</option>
            </select>
          </div>
        )}
        <div className="form-group">
          <label className="form-label">Сума *</label>
          <input type="number" className="form-input" value={amount} onChange={e => setAmount(e.target.value)} min="0" step="0.01" />
        </div>
        <div className="form-group">
          <label className="form-label">Банк *</label>
          <select className="form-input" value={bank} onChange={e => setBank(e.target.value)}>
            <option value="">Оберіть банк</option>
            {BANKS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Категорія</label>
          <input type="text" className="form-input" value={category} onChange={e => setCategory(e.target.value)} placeholder="Проєкт, офіс, реклама..." />
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Опис</label>
          <input type="text" className="form-input" value={description} onChange={e => setDescription(e.target.value)} />
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
