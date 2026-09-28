'use client';
import { useState, useEffect } from 'react';
import type { Partner } from '@/types';
import { displayCurrency, currencySymbol } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';

interface PartnerFormProps {
  isOpen: boolean;
  partner?: Partner | null;
  onSave: (data: Partial<Partner>) => void;
  onCancel: () => void;
}

export default function PartnerForm({ isOpen, partner, onSave, onCancel }: PartnerFormProps) {
  const [name, setName] = useState('');
  const [services, setServices] = useState('');
  const [currency, setCurrency] = useState('UAH');
  const [paidToPartner, setPaidToPartner] = useState('');
  const [givenProjectsCount, setGivenProjectsCount] = useState('');
  const [givenProjectsPrice, setGivenProjectsPrice] = useState('');
  const [ourCommission, setOurCommission] = useState('');
  const [paidToUs, setPaidToUs] = useState('');

  useEffect(() => {
    if (partner) {
      setName(partner.name || '');
      setServices(partner.services || '');
      setCurrency(partner.currency || 'UAH');
      setPaidToPartner(String(partner.paidToPartner || ''));
      setGivenProjectsCount(String(partner.givenProjectsCount || ''));
      setGivenProjectsPrice(String(partner.givenProjectsPrice || ''));
      setOurCommission(String(partner.ourCommission || ''));
      setPaidToUs(String(partner.paidToUs || ''));
    } else {
      setName(''); setServices(''); setCurrency(displayCurrency()); setPaidToPartner(''); setGivenProjectsCount('');
      setGivenProjectsPrice(''); setOurCommission(''); setPaidToUs('');
    }
  }, [partner, isOpen]);

  const handleSave = () => {
    onSave({
      name, services, currency,
      paidToPartner: Number(paidToPartner) || 0,
      givenProjectsCount: Number(givenProjectsCount) || 0,
      givenProjectsPrice: Number(givenProjectsPrice) || 0,
      ourCommission: Number(ourCommission) || 0,
      paidToUs: Number(paidToUs) || 0,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={partner ? 'Редагувати партнера' : 'Новий партнер'}>
      <div className="form-grid">
        <div className="form-group form-group--full">
          <label className="form-label">Назва / ім&apos;я *</label>
          <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Послуги</label>
          <input type="text" className="form-input" value={services} onChange={e => setServices(e.target.value)} placeholder="SEO, реклама, дизайн..." />
        </div>
        <div className="form-group">
          <label className="form-label">Валюта *</label>
          <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
            <option value="UAH">₴ Гривня</option>
            <option value="USD">$ Долар</option>
            <option value="EUR">€ Євро</option>
          </select>
        </div>
        <div className="form-group form-group--full">
          <label className="form-label">Виплачено партнеру ({currencySymbol(currency)})</label>
          <input type="number" className="form-input" value={paidToPartner} onChange={e => setPaidToPartner(e.target.value)} min="0" placeholder="0" />
          <small className="form-hint">Комісія та борг рахуються автоматично з проєктів</small>
        </div>
        <div className="form-group">
          <label className="form-label">Проєктів передали їм</label>
          <input type="number" className="form-input" value={givenProjectsCount} onChange={e => setGivenProjectsCount(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">Ціна переданих проєктів ({currencySymbol(currency)})</label>
          <input type="number" className="form-input" value={givenProjectsPrice} onChange={e => setGivenProjectsPrice(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">Наша комісія ({currencySymbol(currency)})</label>
          <input type="number" className="form-input" value={ourCommission} onChange={e => setOurCommission(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">Виплачено нам ({currencySymbol(currency)})</label>
          <input type="number" className="form-input" value={paidToUs} onChange={e => setPaidToUs(e.target.value)} min="0" placeholder="0" />
          <small className="form-hint">Їхній борг рахується як наша комісія мінус виплачено нам</small>
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={handleSave} />
    </Modal>
  );
}
