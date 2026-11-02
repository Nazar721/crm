'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import type { Project, Specialist, Partner } from '@/types';
import { project as calcProject } from '@/lib/calc';
import { autoMyPercent, resolveMyShare } from '@/lib/my-share';
import { formatMoney, today, displayCurrency, currencySymbol } from '@/lib/utils';
import { rateForCurrency } from '@/lib/calc';
import { getClients, getAllProjects } from '@/lib/storage';
import { normalizeBank, bankLabel } from '@/lib/banks';
import { buildProjectPayload, type ProjectExecutorValues } from '@/lib/project-payload';
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

/**
 * Пакет 07: рядки виконавців для форми.
 * - нові записи — збережений масив executors як є;
 * - старі (один developerId) — один рядок: частка 100 − myPercent,
 *   виплата з legacy-поля paidToSpecialist;
 * - копія (resetPaid) — виплати завжди порожні.
 */
function executorValuesFromProject(source: Partial<Project>, resetPaid = false): ProjectExecutorValues[] {
  if (Array.isArray(source.executors) && source.executors.length) {
    return source.executors.map(e => ({
      specialistId: e.specialistId,
      percent: e.percent === undefined || e.percent === null ? '' : String(e.percent),
      paid: resetPaid ? '' : String(e.paid ?? ''),
    }));
  }
  if (source.developerId) {
    const myPercent = Number(source.myPercent) || 0;
    return [{
      specialistId: source.developerId,
      percent: String(Math.max(0, 100 - myPercent)),
      paid: resetPaid ? '' : String(source.paidToSpecialist || ''),
    }];
  }
  return [];
}

export default function ProjectForm({ isOpen, project, copyPrefill, copyWarnings, copyNeedsClientChoice, specialists, partners, onSave, onCancel }: ProjectFormProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('Очікування оплати');
  const [startDate, setStartDate] = useState('');
  const [deadlineDays, setDeadlineDays] = useState('');
  const [endDate, setEndDate] = useState('');
  // Пакет 07: явні виконавці (може бути один або кілька) та «Я» (власник).
  // Для «Я» окремого відсотка немає — використовується «Мій %».
  const [executors, setExecutors] = useState<ProjectExecutorValues[]>([]);
  const [selfExecutor, setSelfExecutor] = useState(false);
  const [shareError, setShareError] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientTelegram, setClientTelegram] = useState('');
  const [clientSource, setClientSource] = useState('Інше');
  const [budget, setBudget] = useState('');
  const [currency, setCurrency] = useState('UAH');
  const [bank, setBank] = useState('');
  const [prepayment, setPrepayment] = useState('');
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
    setShareError('');
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
      setExecutors(executorValuesFromProject(project));
      setSelfExecutor(!!project.selfExecutor);
      setPartnerId(project.partnerId || '');
      setClientName(card ? card.name : project.clientName || '');
      setClientTelegram(card ? (card.telegram || '') : project.clientTelegram || '');
      setClientSource(card ? (card.source || 'Інше') : project.clientSource || 'Інше');
      setBudget(String(project.budget || ''));
      setCurrency(project.currency || 'UAH');
      setBank(project.bank || '');
      setPrepayment(String(project.prepayment || ''));
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
      setExecutors(executorValuesFromProject(copyPrefill, true));
      setSelfExecutor(!!copyPrefill.selfExecutor);
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
      setMyPercent(copyPrefill.myPercent !== undefined && copyPrefill.myPercent !== null ? String(copyPrefill.myPercent) : '');
      setProfitTaken('');
      setFop(copyPrefill.fop !== undefined && copyPrefill.fop !== null ? String(copyPrefill.fop) : '');
      setPartnerCommission(copyPrefill.partnerCommission !== undefined && copyPrefill.partnerCommission !== null ? String(copyPrefill.partnerCommission) : '');
      setDescription(copyPrefill.description || '');
      setSelectedClientId(copyPrefill.clientId || '');
      setAutoPercent(false);
    } else {
      setName(''); setType(''); setStatus('Очікування оплати'); setStartDate(today());
      setDeadlineDays(''); setEndDate(''); setExecutors([]); setSelfExecutor(false); setPartnerId('');
      setClientName(''); setClientTelegram(''); setClientSource('Інше');
      setBudget(''); setCurrency(displayCurrency()); setBank(''); setPrepayment('');
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

  // Перший виконавець визначає правило «Моя частка» (як і раніше один
  // обраний фахівець). Для кількох фахівців правило лишається підказкою
  // для «Мого %», а частки решти вводяться вручну.
  const activeSpecialist = useMemo(() => {
    const id = executors[0]?.specialistId;
    return id ? specialists.find(d => d.id === id) : undefined;
  }, [specialists, executors]);

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

  const addExecutor = (specialistId: string) => {
    if (!specialistId) return;
    setShareError('');
    setExecutors(rows => rows.some(r => r.specialistId === specialistId)
      ? rows
      : [...rows, { specialistId, percent: '', paid: '' }]);
  };

  const updateExecutor = (specialistId: string, patch: Partial<ProjectExecutorValues>) => {
    setShareError('');
    setExecutors(rows => rows.map(r => (r.specialistId === specialistId ? { ...r, ...patch } : r)));
  };

  const removeExecutor = (specialistId: string) => {
    setShareError('');
    setExecutors(rows => rows.filter(r => r.specialistId !== specialistId));
  };

  // Сума відсотків для підказки/попередньої перевірки. Значення ніколи
  // не змінюються автоматично — лише показується, скільки лишилось.
  const executorPercentSum = executors.reduce((sum, row) => sum + (Number(row.percent) || 0), 0);
  const myPercentNumber = Number(effectiveMyPercent) || 0;
  const sharesTotal = executorPercentSum + myPercentNumber;
  // Правило 100% застосовується, коли виконавці явні (є зовнішні або «Я»).
  const shareRuleActive = executors.length > 0 || selfExecutor;

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
      paidToSpecialist: 0,
      myPercent: Number(effectiveMyPercent) || 0,
      profitTaken: Number(profitTaken) || 0,
      fop: Number(fop) || 0,
      partnerCommission: Number(partnerCommission) || 0,
      executors: executors.map(e => ({
        specialistId: e.specialistId,
        percent: Number(e.percent) || 0,
        paid: Number(e.paid) || 0,
      })),
      selfExecutor,
    } as Project);
  }, [budget, currency, prepayment, effectiveMyPercent, profitTaken, fop, partnerCommission, executors, selfExecutor]);

  const shareSummary = useMemo(() => {
    if (!shareRuleActive) return null;
    if (Math.abs(sharesTotal - 100) < 1e-9) {
      return { tone: 'ok' as const, text: 'Розподілено рівно 100%' };
    }
    if (sharesTotal > 100) {
      return {
        tone: 'over' as const,
        text: `Сума часток ${Math.round(sharesTotal * 1e6) / 1e6}% перевищує 100% — зменшіть частки або «Мій %».`,
      };
    }
    return {
      tone: 'under' as const,
      text: `Нерозподілено ${Math.round((100 - sharesTotal) * 1e6) / 1e6}% — сума часток разом із «Мій %» має дорівнювати 100%.`,
    };
  }, [shareRuleActive, sharesTotal]);

  const handleSave = async () => {
    if (savingRef.current) return;
    // Копія з видаленою карткою клієнта: без явного вибору наявного клієнта
    // або підтвердження створення нової картки — збереження не відбувається.
    if (copyNeedsClientChoice && !selectedClientId && !confirmNewClient) {
      setClientChoiceError('Оберіть клієнта зі списку або підтвердьте створення нової картки.');
      return;
    }
    // Пакет 07: сума часток мусить дорівнювати 100%. Повідомлення
    // показується, введені значення не змінюються автоматично.
    if (shareRuleActive && Math.abs(sharesTotal - 100) >= 1e-9) {
      setShareError(sharesTotal > 100
        ? `Сума часток ${Math.round(sharesTotal * 1e6) / 1e6}% перевищує 100%. Зменшіть частки або «Мій %» — введені значення не змінено.`
        : `Нерозподілений залишок ${Math.round((100 - sharesTotal) * 1e6) / 1e6}%. Сума часток разом із «Мій %» має дорівнювати 100% — введені значення не змінено.`);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setClientChoiceError('');
    setShareError('');
    try {
      // Одне явне payload зі стану форми. Джерело clientId — поточний
      // selectedClientId (prefill лише ініціалізує); дані клієнта за наявної
      // картки беруться з неї ж (без fallback на історичні контакти стану).
      await onSave(buildProjectPayload({
        name, type, status, startDate,
        deadlineDays,
        endDate,
        partnerId,
        clientName, clientTelegram, clientSource,
        budget,
        currency,
        bank,
        prepayment,
        myPercent: effectiveMyPercent,
        profitTaken,
        fop,
        partnerCommission,
        description,
        selectedClientId,
        executors,
        selfExecutor,
      }, getClients()));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const selectedExecutorIds = new Set(executors.map(e => e.specialistId));
  const availableSpecialists = specialists.filter(s => !selectedExecutorIds.has(s.id));

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={project ? 'Редагувати проєкт' : 'Новий проєкт'} size="lg" onSubmit={handleSave}>
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
          <label className="form-label">Партнер</label>
          <select className="form-input" value={partnerId} onChange={e => setPartnerId(e.target.value)}>
            <option value="">— без партнера —</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Пакет 07: виконавці — один або кілька зовнішніх фахівців + «Я». */}
        <div className="form-group form-group--full">
          <label className="form-label">Виконавці</label>
          <div className="executor-editor">
            <label className="executor-self">
              <input
                type="checkbox"
                checked={selfExecutor}
                onChange={e => { setSelfExecutor(e.target.checked); setShareError(''); }}
              />
              <span>
                <strong>Я</strong> — власник. Частка береться з поля «Мій %»;
                виплат і боргу самому собі не створюється.
              </span>
            </label>

            {executors.map(row => {
              const specialist = specialists.find(s => s.id === row.specialistId);
              const share = calc.shares.find(s => s.specialistId === row.specialistId);
              return (
                <div className="executor-row" key={row.specialistId}>
                  <div className="executor-row__name">
                    <strong>{specialist?.name || 'Фахівця видалено'}</strong>
                    {specialist?.specialization && <span className="cell-secondary">{specialist.specialization}</span>}
                  </div>
                  <label className="executor-row__field">
                    <span>Частка, %</span>
                    <input
                      type="number"
                      className="form-input"
                      value={row.percent}
                      onChange={e => updateExecutor(row.specialistId, { percent: e.target.value })}
                      min="0"
                      max="100"
                      step="any"
                      placeholder="0"
                    />
                  </label>
                  <label className="executor-row__field">
                    <span>Виплачено, {currencySymbol(currency)}</span>
                    <input
                      type="number"
                      className="form-input"
                      value={row.paid}
                      onChange={e => updateExecutor(row.specialistId, { paid: e.target.value })}
                      min="0"
                      placeholder="0"
                    />
                  </label>
                  <div className="executor-row__debt">
                    <span>Борг (авто)</span>
                    <strong>{formatMoney(share?.debt ?? 0, currency)}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn-icon btn-icon--danger"
                    title="Прибрати виконавця"
                    onClick={() => removeExecutor(row.specialistId)}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2"/></svg>
                  </button>
                </div>
              );
            })}

            {availableSpecialists.length > 0 && (
              <select
                className="form-input executor-add"
                value=""
                onChange={e => addExecutor(e.target.value)}
              >
                <option value="">+ Додати фахівця</option>
                {availableSpecialists.map(d => <option key={d.id} value={d.id}>{d.name} ({d.specialization})</option>)}
              </select>
            )}
            {!specialists.length && (
              <small className="form-hint">Карток фахівців ще немає — додайте їх у розділі «Фахівці».</small>
            )}

            <div className={`executor-sum${shareSummary ? ` executor-sum--${shareSummary.tone}` : ''}`}>
              {shareSummary
                ? shareSummary.text
                : 'Без зовнішніх виконавців і «Я» діє стара формула: фахівець (якщо вибраний) отримує 100 − «Мій %», боргу без фахівця не створюється.'}
            </div>
            {shareSummary && (
              <small className="form-hint">
                Розподілено: фахівці {Math.round(executorPercentSum * 1e6) / 1e6}% + «Мій %» {Math.round(myPercentNumber * 1e6) / 1e6}% = {Math.round(sharesTotal * 1e6) / 1e6}%
              </small>
            )}
            {shareError && <div className="executor-error">{shareError}</div>}
          </div>
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
          <label className="form-label">Вартість фахівців (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.specialistCost, currency)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Виплачено фахівцям (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.paidToSpecialist, currency)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Борг фахівцям (авто)</label>
          <input type="text" className="form-input form-input--readonly" value={formatMoney(calc.specialistDebt, currency)} readOnly />
        </div>
        <div className="form-group">
          <label className="form-label">Мій % від суми</label>
          <input
            type="number"
            className="form-input"
            value={effectiveMyPercent}
            onChange={e => { setMyPercent(e.target.value); setAutoPercent(false); setShareError(''); }}
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
