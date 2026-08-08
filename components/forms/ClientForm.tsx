'use client';
import { useState, useEffect } from 'react';
import type { Client } from '@/types';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';

interface ClientFormProps {
  isOpen: boolean;
  client?: Client | null;
  onSave: (data: Partial<Client>) => void;
  onCancel: () => void;
}

export default function ClientForm({ isOpen, client, onSave, onCancel }: ClientFormProps) {
  const [name, setName] = useState('');
  const [telegram, setTelegram] = useState('');
  const [source, setSource] = useState('Інше');
  const [isRegular, setIsRegular] = useState(false);

  useEffect(() => {
    if (client) {
      setName(client.name || '');
      setTelegram(client.telegram || '');
      setSource(client.source || 'Інше');
      setIsRegular(!!client.isRegular);
    }
  }, [client, isOpen]);

  const handleSave = () => {
    onSave({ name, telegram, source, isRegular });
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Редагувати клієнта">
      <div className="form-grid">
        <div className="form-group">
          <label className="form-label">Ім&apos;я *</label>
          <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Telegram</label>
          <input type="text" className="form-input" value={telegram} onChange={e => setTelegram(e.target.value)} />
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Джерело</label>
          <select className="form-input" value={source} onChange={e => setSource(e.target.value)}>
            <option value="Інше">Інше</option>
            <option value="Telegram">Telegram</option>
            <option value="Instagram">Instagram</option>
            <option value="YouTube">YouTube</option>
            <option value="Реклама">Реклама</option>
            <option value="Сайт">Сайт</option>
            <option value="Сарафанне радіо">Сарафанне радіо</option>
          </select>
        </div>
        <div className="form-group form-group--full">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input type="checkbox" checked={isRegular} onChange={e => setIsRegular(e.target.checked)} style={{ width: 18, height: 18 }} />
            Постійний клієнт
          </label>
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={handleSave} />
    </Modal>
  );
}
