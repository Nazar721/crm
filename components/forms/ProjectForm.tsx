'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { Project, Specialist, Partner } from '@/types';
import { project as calcProject } from '@/lib/calc';
import { formatMoney } from '@/lib/utils';
import { today } from '@/lib/utils';
import { getClients } from '@/lib/storage';
import type { Client } from '@/types';

import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';

interface ProjectFormProps {
  isOpen: boolean;
  project?: Project | null;
  specialists: Specialist[];
  partners: Partner[];
  onSave: (data: Partial<Project>) => void;
  onCancel: () => void;
}

export default function ProjectForm({ isOpen, project, specialists, partners, onSave, onCancel }: ProjectFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('Очікування оплати');
  const [startDate, setStartDate] = useState('');
  const [deadlineDays, setDeadlineDays] = useState('');
  const [endDate, setEndDate] = useState('');
  const [developerId, setDeveloperId] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientTelegram, setClientTelegram] = useState('');
  const [clientSource, setClientSource] = useState('Інше');
  const [budget, setBudget] = useState('');
  const [bank, setBank] = useState('');
  const [prepayment, setPrepayment] = useState('');
  const [paidToSpecialist, setPaidToSpecialist] = useState('');
  const [myPercent, setMyPercent] = useState('');
  const [profitTaken, setProfitTaken] = useState('');
  const [fop, setFop] = useState('');
  const [partnerCommission, setPartnerCommission] = useState('');
  const [description, setDescription] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (project) {
      setName(project.name || '');
      setType(project.type || '');
      setStatus(project.status || 'Очікування оплати');
      setStartDate(project.startDate || '');
      setDeadlineDays(String(project.deadlineDays || ''));
      setEndDate(project.endDate || '');
      setDeveloperId(project.developerId || '');
      setPartnerId(project.partnerId || '');
      setClientName(project.clientName || '');
      setClientTelegram(project.clientTelegram || '');
      setClientSource(project.clientSource || 'Інше');
      setBudget(String(project.budget || ''));
      setBank(project.bank || '');
      setPrepayment(String(project.prepayment || ''));
      setPaidToSpecialist(String(project.paidToSpecialist || ''));
      setMyPercent(String(project.myPercent ?? ''));
      setProfitTaken(String(project.profitTaken || ''));
      setFop(String(project.fop || ''));
      setPartnerCommission(String(project.partnerCommission || ''));
      setDescription(project.description || '');
      setSelectedClientId(project.clientId || '');
    } else {
      setName(''); setType(''); setStatus('Очікування оплати'); setStartDate(today());
      setDeadlineDays(''); setEndDate(''); setDeveloperId(''); setPartnerId('');
      setClientName(''); setClientTelegram(''); setClientSource('Інше');
      setBudget(''); setBank(''); setPrepayment(''); setPaidToSpecialist('');
      setMyPercent(''); setProfitTaken(''); setFop(''); setPartnerCommission('');
      setDescription(''); setSelectedClientId('');
    }
    setShowSuggestions(false);
  }, [project, isOpen]);

  useEffect(() => {
    if (Number(prepayment) > 0 && status === 'Очікування оплати') {
      setStatus('В роботі');
    }
  }, [prepayment]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const clientSuggestions = useMemo(() => {
    if (clientName.length < 2 || selectedClientId) return [];
    const q = clientName.toLowerCase().trim();
    const clients = getClients();
    return clients
      .filter(c => c.name.toLowerCase().includes(q) || (c.telegram || '').toLowerCase().includes(q))
      .slice(0, 8);
  }, [clientName, selectedClientId]);

  const selectClient = (c: Client) => {
    setClientName(c.name);
    setClientTelegram(c.telegram || '');
    setClientSource(c.source || 'Інше');
    setSelectedClientId(c.id);
    setShowSuggestions(false);
  };

  const handleClientNameChange = (val: string) => {
    setClientName(val);
    setSelectedClientId('');
    setShowSuggestions(val.length >= 2);
  };

  const calc = useMemo(() => {
    return calcProject({
      id: '',
      name: '',
      type: '',
      status: '',
      startDate: '',
      clientId: '',
      clientName: '',
      budget: Number(budget) || 0,
      prepayment: Number(prepayment) || 0,
      paidToSpecialist: Number(paidToSpecialist) || 0,
      myPercent: Number(myPercent) || 0,
      profitTaken: Number(profitTaken) || 0,
      fop: Number(fop) || 0,
      partnerCommission: Number(partnerCommission) || 0,
    } as Project);
  }, [budget, prepayment, paidToSpecialist, myPercent, profitTaken, fop, partnerCommission]);

  const handleSave = () => {
    onSave({
      name, type, status, startDate,
      deadlineDays: Number(deadlineDays) || 0,
      endDate,
      developerId, partnerId,
      clientName, clientTelegram, clientSource,
      budget: Number(budget) || 0,
      bank,
      prepayment: Number(prepayment) || 0,
      paidToSpecialist: Number(paidToSpecialist) || 0,
      myPercent: Number(myPercent) || 0,
      profitTaken: Number(profitTaken) || 0,
      fop: Number(fop) || 0,
      partnerCommission: Number(partnerCommission) || 0,
      description,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={project ? 'Редагувати проєкт' : 'Новий проєкт'} size="lg">
      <div className="form-grid">
        <div className="form-group form-group--full">
          <label className="form-label">Назва проєкту *</label>
          <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="Наприклад: Сайт для кафе" />
        </div>
        <div className="form-group">
          <label className="form-label">Тип *</label>
          <select className="form-input" value={type} onChange={e => setType(e.target.value)}>
            <option value="">Оберіть тип</option>
            <option value="IT">IT</option>
            <option value="Design">Design</option>
            <option value="Video">Video</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Статус *</label>
          <select className="form-input" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="Очікування оплати">Очікування оплати</option>
            <option value="В роботі">В роботі</option>
            <option value="На паузі">На паузі</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Дата старту *</label>
          <input type="date" className="form-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Дедлайн (днів)</label>
          <input type="number" className="form-input" value={deadlineDays} onChange={e => setDeadlineDays(e.target.value)} min="0" placeholder="2" />
        </div>
        <div className="form-group">
          <label className="form-label">Дата завершення</label>
          <input type="date" className="form-input" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Фахівець</label>
          <select className="form-input" value={developerId} onChange={e => setDeveloperId(e.target.value)}>
            <option value="">— без фахівця —</option>
            {specialists.map(d => <option key={d.id} value={d.id}>{d.name} ({d.specialization})</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Партнер</label>
          <select className="form-input" value={partnerId} onChange={e => setPartnerId(e.target.value)}>
            <option value="">— без партнера —</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="form-group client-autocomplete" ref={wrapperRef}>
          <label className="form-label">Ім&apos;я клієнта *</label>
          <input
            type="text"
            className="form-input"
            value={clientName}
            onChange={e => handleClientNameChange(e.target.value)}
            onFocus={() => { if (clientName.length >= 2 && !selectedClientId) setShowSuggestions(true); }}
            placeholder="Почніть вводити ім'я..."
            autoComplete="off"
          />
          {showSuggestions && clientSuggestions.length > 0 && (
            <div className="client-suggestions">
              {clientSuggestions.map(c => (
                  <div key={c.id} className="client-suggestion-item" onMouseDown={() => selectClient(c)}>
                    <div>
                      <span className="client-suggestion-name">{c.name}</span>
                      {c.telegram && <span className="client-suggestion-tg"> {c.telegram}</span>}
                    </div>
                    {c.isRegular && <span className="client-suggestion-badge badge badge--green">Постійний</span>}
                  </div>
              ))}
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Telegram клієнта</label>
          <input type="text" className="form-input" value={clientTelegram} onChange={e => setClientTelegram(e.target.value)} placeholder="@username" />
        </div>
        <div className="form-group">
          <label className="form-label">Джерело клієнта</label>
          <select className="form-input" value={clientSource} onChange={e => setClientSource(e.target.value)}>
            <option value="Інше">Інше</option>
            <option value="Telegram">Telegram</option>
            <option value="Instagram">Instagram</option>
            <option value="YouTube">YouTube</option>
            <option value="Реклама">Реклама</option>
            <option value="Сайт">Сайт</option>
            <option value="Сарафанне радіо">Сарафанне радіо</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Бюджет (₴) *</label>
          <input type="number" className="form-input" value={budget} onChange={e => setBudget(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">Банк</label>
          <input type="text" className="form-input" value={bank} onChange={e => setBank(e.target.value)} placeholder="Назва банку" />
        </div>
        <div className="form-group">
          <label className="form-label">Передоплата (₴)</label>
          <input type="number" className="form-input" value={prepayment} onChange={e => setPrepayment(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">До доплати (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.remainingPayment)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Вартість фахівця (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.specialistCost)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Виплачено фахівцю (₴)</label>
          <input type="number" className="form-input" value={paidToSpecialist} onChange={e => setPaidToSpecialist(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">Борг фахівцю (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.specialistDebt)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Мій % від суми</label>
          <input type="number" className="form-input" value={myPercent} onChange={e => setMyPercent(e.target.value)} min="0" max="100" placeholder="30" />
        </div>
        <div className="form-group">
          <label className="form-label">Прибуток (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.projectProfit)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Забрав собі (₴)</label>
          <input type="number" className="form-input" value={profitTaken} onChange={e => setProfitTaken(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">Лишилось (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.profitLeft)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">ФОП (%)</label>
          <input type="number" className="form-input" value={fop} onChange={e => setFop(e.target.value)} min="0" max="100" placeholder="10" />
          <small className="form-hint">Відсоток ФОП, віднімається від суми клієнта</small>
        </div>
        {partnerId && (
          <div className="form-group">
            <label className="form-label">Комісія партнеру (%)</label>
            <input type="number" className="form-input" value={partnerCommission} onChange={e => setPartnerCommission(e.target.value)} min="0" max="100" placeholder="10" />
            <small className="form-hint">Відсоток партнеру, віднімається від суми клієнта</small>
          </div>
        )}
        <div className="form-group form-group--full">
          <label className="form-label">Опис</label>
          <textarea className="form-input form-textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="Деталі проєкту..." />
        </div>
      </div>
      <ModalFooter onCancel={onCancel} onSave={handleSave} />
    </Modal>
  );
}
