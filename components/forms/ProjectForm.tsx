'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { Project, Specialist, Partner } from '@/types';
import { project as calcProject } from '@/lib/calc';
import { autoMyPercent, resolveMyShare } from '@/lib/my-share';
import { formatMoney, today, displayCurrency, currencySymbol } from '@/lib/utils';
import { rateForCurrency } from '@/lib/calc';
import { getClients, getAllProjects } from '@/lib/storage';
import { normalizeBank, bankLabel } from '@/lib/banks';
import { buildProjectPayload } from '@/lib/project-payload';
import type { Client } from '@/types';

import Modal from '@/components/ui/Modal';
import ModalFooter from '@/components/ui/ModalFooter';
import AutocompleteInput from '@/components/ui/AutocompleteInput';

interface ProjectFormProps {
  isOpen: boolean;
  project?: Project | null;
  /**
   * Пакет 02: початкові поля копії завершеного проєкту. Форма лишається
   * формою СТВОРЕННЯ (project === null), але із заповненими умовами;
   * скинуті поля (оплати/дати/банк) примусово порожні.
   */
  copyPrefill?: Partial<Project> | null;
  /** Попередження: пов'язану сутність видалено — поле треба обрати заново. */
  copyWarnings?: string[];
  /**
   * Пакет 02: картку клієнта в джерелі копії видалено. Форма вимагає
   * явного рішення — обрати наявного клієнта зі списку або підтвердити
   * створення нової картки; без цього збереження не відбувається.
   */
  copyNeedsClientChoice?: boolean;
  specialists: Specialist[];
  partners: Partner[];
  onSave: (data: Partial<Project>) => void | Promise<void>;
  onCancel: () => void;
}

export default function ProjectForm({ isOpen, project, copyPrefill, copyWarnings, copyNeedsClientChoice, specialists, partners, onSave, onCancel }: ProjectFormProps) {
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
  const [currency, setCurrency] = useState('UAH');
  const [bank, setBank] = useState('');
  const [prepayment, setPrepayment] = useState('');
  const [paidToSpecialist, setPaidToSpecialist] = useState('');
  const [myPercent, setMyPercent] = useState('');
  const [autoPercent, setAutoPercent] = useState(true);
  const [profitTaken, setProfitTaken] = useState('');
  const [fop, setFop] = useState('');
  const [partnerCommission, setPartnerCommission] = useState('');
  const [description, setDescription] = useState('');
  const [selectedClientId, setSelectedClientId] = useState('');
  // Копія з видаленою карткою клієнта: явна згода на створення нової картки
  // (обрати наявного клієнта зі списку — інший, достатній шлях).
  const [confirmNewClient, setConfirmNewClient] = useState(false);
  const [clientChoiceError, setClientChoiceError] = useState('');
  // Подвійне натискання «Зберегти» не має створювати дубль: реф ловить
  // другий клік у тому ж такті, стан — гасить кнопку після ре-рендера.
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    // Кожне відкриття форми починає з чистої згоди/помилки вибору клієнта.
    setConfirmNewClient(false);
    setClientChoiceError('');
    if (project) {
      // Картка клієнта (якщо ще існує) показується як джерело істини для
      // імені та контактів — форма показує саме те, що збереже спільна дія.
      const card = project.clientId ? getClients().find(c => c.id === project.clientId) : undefined;
      setName(project.name || '');
      setType(project.type || '');
      setStatus(project.status || 'Очікування оплати');
      setStartDate(project.startDate || '');
      setDeadlineDays(String(project.deadlineDays || ''));
      setEndDate(project.endDate || '');
      setDeveloperId(project.developerId || '');
      setPartnerId(project.partnerId || '');
      setClientName(card ? card.name : project.clientName || '');
      setClientTelegram(card ? (card.telegram || '') : project.clientTelegram || '');
      setClientSource(card ? (card.source || 'Інше') : project.clientSource || 'Інше');
      setBudget(String(project.budget || ''));
      setCurrency(project.currency || 'UAH');
      setBank(project.bank || '');
      setPrepayment(String(project.prepayment || ''));
      setPaidToSpecialist(String(project.paidToSpecialist || ''));
      setMyPercent(String(project.myPercent ?? ''));
      setProfitTaken(String(project.profitTaken || ''));
      setFop(String(project.fop || ''));
      setPartnerCommission(String(project.partnerCommission || ''));
      setDescription(project.description || '');
      setSelectedClientId(project.clientId || '');
      // Наявний проєкт: відсоток лишається як є, автозастосування вимкнене.
      setAutoPercent(false);
    } else if (copyPrefill) {
      // Пакет 02: копія. Умови — із заповнених полів; усі скинуті поля
      // (оплати/виплати/дати/банк) примусово порожні, статус і старт —
      // типові для нового проєкту. Автовідсоток вимкнено: підставлена
      // умова показується явно і лишається ручною до збереження.
      setName(copyPrefill.name || '');
      setType(copyPrefill.type || '');
      setStatus('Очікування оплати');
      setStartDate(copyPrefill.startDate || today());
      setDeadlineDays(copyPrefill.deadlineDays !== undefined && copyPrefill.deadlineDays !== null ? String(copyPrefill.deadlineDays) : '');
      setEndDate('');
      setDeveloperId(copyPrefill.developerId || '');
      setPartnerId(copyPrefill.partnerId || '');
      // Клієнт: якщо картка з ID копії ще існує — показуємо її поточні
      // ім'я/контакти (історичні значення проєкту не маскуємо як чинні);
      // якщо картку видалено — лишаємо історичний текст, але ID не підставляємо.
      const copyCard = copyPrefill.clientId ? getClients().find(c => c.id === copyPrefill.clientId) : undefined;
      setClientName(copyCard ? copyCard.name : copyPrefill.clientName || '');
      setClientTelegram(copyCard ? (copyCard.telegram || '') : copyPrefill.clientTelegram || '');
      setClientSource(copyCard ? (copyCard.source || 'Інше') : copyPrefill.clientSource || 'Інше');
      setBudget(copyPrefill.budget !== undefined && copyPrefill.budget !== null ? String(copyPrefill.budget) : '');
      setCurrency(copyPrefill.currency || 'UAH');
      setBank('');
      setPrepayment('');
      setPaidToSpecialist('');
      setMyPercent(copyPrefill.myPercent !== undefined && copyPrefill.myPercent !== null ? String(copyPrefill.myPercent) : '');
      setProfitTaken('');
      setFop(copyPrefill.fop !== undefined && copyPrefill.fop !== null ? String(copyPrefill.fop) : '');
      setPartnerCommission(copyPrefill.partnerCommission !== undefined && copyPrefill.partnerCommission !== null ? String(copyPrefill.partnerCommission) : '');
      setDescription(copyPrefill.description || '');
      setSelectedClientId(copyPrefill.clientId || '');
      setAutoPercent(false);
    } else {
      setName(''); setType(''); setStatus('Очікування оплати'); setStartDate(today());
      setDeadlineDays(''); setEndDate(''); setDeveloperId(''); setPartnerId('');
      setClientName(''); setClientTelegram(''); setClientSource('Інше');
      setBudget(''); setCurrency(displayCurrency()); setBank(''); setPrepayment(''); setPaidToSpecialist('');
      setMyPercent(''); setProfitTaken(''); setFop(''); setPartnerCommission('');
      setDescription(''); setSelectedClientId('');
      // Новий проєкт: автоправило фахівця увімкнене.
      setAutoPercent(true);
    }
  }, [project, isOpen, copyPrefill]);

  useEffect(() => {
    if (Number(prepayment) > 0 && status === 'Очікування оплати') {
      setStatus('В роботі');
    }
  }, [prepayment]);

  const clientOptions = useMemo(() => {
    return getClients().map(c => ({
      value: c.name,
      hint: c.telegram || undefined,
      badge: c.isRegular ? 'Постійний' : undefined,
      data: c,
    }));
  }, [isOpen]);

  const bankOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of getAllProjects()) {
      const raw = String(p.bank || '').trim();
      if (!raw) continue;
      const key = normalizeBank(raw);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value: bankLabel(value), hint: count > 1 ? `×${count}` : undefined }));
  }, [isOpen]);

  const handleClientNameChange = (val: string) => {
    setClientName(val);
    setSelectedClientId('');
  };

  // Обраний фахівець та його правило «Моя частка».
  const activeSpecialist = useMemo(
    () => specialists.find(d => d.id === developerId),
    [specialists, developerId],
  );

  // Автоматичний відсоток: null — фахівця не вибрано або бюджет
  // некоректний (порожній/не число/від'ємний) — тоді нічого не підставляємо.
  const autoValue = useMemo(
    () => autoMyPercent(activeSpecialist, budget, currency),
    [activeSpecialist, budget, currency],
  );

  // Правило показується під полем, коли автозастосування увімкнене.
  const autoRule = activeSpecialist ? resolveMyShare(activeSpecialist) : null;

  // Показуване значення: у автоматичному режимі — правило фахівця,
  // інакше — збережений у стані (ручний) відсоток.
  const effectiveMyPercent = autoPercent && autoValue !== null ? String(autoValue) : myPercent;

  const handleAutoToggle = (checked: boolean) => {
    if (checked) {
      // Увімкнення застосовує правило фахівця.
      setAutoPercent(true);
      if (autoValue !== null) setMyPercent(String(autoValue));
    } else {
      // Вимкнення фіксує поточне (авто-)значення — далі воно ручне.
      setMyPercent(effectiveMyPercent);
      setAutoPercent(false);
    }
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
      currency,
      prepayment: Number(prepayment) || 0,
      paidToSpecialist: Number(paidToSpecialist) || 0,
      myPercent: Number(effectiveMyPercent) || 0,
      profitTaken: Number(profitTaken) || 0,
      fop: Number(fop) || 0,
      partnerCommission: Number(partnerCommission) || 0,
    } as Project);
  }, [budget, currency, prepayment, paidToSpecialist, effectiveMyPercent, profitTaken, fop, partnerCommission]);

  const handleSave = async () => {
    if (savingRef.current) return;
    // Копія з видаленою карткою клієнта: без явного вибору наявного клієнта
    // або підтвердження створення нової картки — збереження не відбувається.
    if (copyNeedsClientChoice && !selectedClientId && !confirmNewClient) {
      setClientChoiceError('Оберіть клієнта зі списку або підтвердьте створення нової картки.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setClientChoiceError('');
    try {
      // Одне явне payload зі стану форми. Джерело clientId — поточний
      // selectedClientId (prefill лише ініціалізує); дані клієнта за наявної
      // картки беруться з неї ж (без fallback на історичні контакти стану).
      await onSave(buildProjectPayload({
        name, type, status, startDate,
        deadlineDays,
        endDate,
        developerId, partnerId,
        clientName, clientTelegram, clientSource,
        budget,
        currency,
        bank,
        prepayment,
        paidToSpecialist,
        myPercent: effectiveMyPercent,
        profitTaken,
        fop,
        partnerCommission,
        description,
        selectedClientId,
      }, getClients()));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={project ? 'Редагувати проєкт' : 'Новий проєкт'} size="lg">
      {copyWarnings && copyWarnings.length > 0 && (
        <div className="backup-warning" style={{ marginBottom: 12 }}>
          <strong>Копіювання: перевірте підставлений проєкт</strong>
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {copyWarnings.map((w, i) => <li key={i} style={{ marginBottom: 4 }}>{w}</li>)}
          </ul>
        </div>
      )}
      {copyNeedsClientChoice && !selectedClientId && (
        <div className="backup-warning" style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={confirmNewClient}
              onChange={e => { setConfirmNewClient(e.target.checked); setClientChoiceError(''); }}
              style={{ marginTop: 3 }}
            />
            <span>
              Створити нову картку клієнта «{clientName || '—'}» при збереженні.
              Або спочатку оберіть наявного клієнта у полі «Ім&apos;я клієнта».
            </span>
          </label>
          {clientChoiceError && (
            <div style={{ color: '#b91c1c', marginTop: 6, fontSize: 13 }}>{clientChoiceError}</div>
          )}
        </div>
      )}
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
        <div className="form-group">
          <label className="form-label">Ім&apos;я клієнта *</label>
          <AutocompleteInput
            value={clientName}
            onChange={handleClientNameChange}
            options={clientOptions}
            onSelect={opt => {
              const c = opt.data as Client;
              if (!c) return;
              setClientTelegram(c.telegram || '');
              setClientSource(c.source || 'Інше');
              setSelectedClientId(c.id);
            }}
            placeholder="Почніть вводити ім'я..."
            filter={(opt, q) =>
              opt.value.toLowerCase().includes(q) ||
              (String((opt.data as Client)?.telegram || '')).toLowerCase().includes(q)
            }
          />
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
          <label className="form-label">Валюта *</label>
          <select className="form-input" value={currency} onChange={e => setCurrency(e.target.value)}>
            <option value="UAH">₴ Гривня</option>
            <option value="USD">$ Долар</option>
            <option value="EUR">€ Євро</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Бюджет ({currencySymbol(currency)}) *</label>
          <input type="number" className="form-input" value={budget} onChange={e => setBudget(e.target.value)} min="0" placeholder="0" />
          {currency !== 'UAH' && Number(budget) > 0 && (
            <small className="form-hint">≈ {formatMoney(Number(budget) * rateForCurrency(currency), 'UAH')}</small>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Банк</label>
          <AutocompleteInput
            value={bank}
            onChange={setBank}
            options={bankOptions}
            placeholder="Назва банку"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Передоплата ({currencySymbol(currency)})</label>
          <input type="number" className="form-input" value={prepayment} onChange={e => setPrepayment(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">До доплати (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.remainingPayment, currency)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Вартість фахівця (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.specialistCost, currency)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Виплачено фахівцю ({currencySymbol(currency)})</label>
          <input type="number" className="form-input" value={paidToSpecialist} onChange={e => setPaidToSpecialist(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">Борг фахівцю (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.specialistDebt, currency)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Мій % від суми</label>
          <input
            type="number"
            className="form-input"
            value={effectiveMyPercent}
            onChange={e => { setMyPercent(e.target.value); setAutoPercent(false); }}
            min="0"
            max="100"
            step="any"
            placeholder="30"
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoPercent}
              onChange={e => handleAutoToggle(e.target.checked)}
            />
            Автоматично
          </label>
          {autoPercent && (
            <small className="form-hint">
              {autoValue !== null && autoRule
                ? `Правило фахівця: ≤ ${formatMoney(autoRule.threshold, 'UAH')} → ${autoRule.percentUpTo}%, понад поріг → ${autoRule.percentAbove}%`
                : 'Оберіть фахівця та вкажіть бюджет, щоб застосувати правило'}
            </small>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Прибуток (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.projectProfit, currency)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Забрав собі ({currencySymbol(currency)})</label>
          <input type="number" className="form-input" value={profitTaken} onChange={e => setProfitTaken(e.target.value)} min="0" placeholder="0" />
        </div>
        <div className="form-group">
          <label className="form-label">Лишилось (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.profitLeft, currency)} readOnly />
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
      <ModalFooter onCancel={onCancel} onSave={handleSave} disabled={saving} saveLabel={saving ? 'Зберігаю…' : 'Зберегти'} />
    </Modal>
  );
}
