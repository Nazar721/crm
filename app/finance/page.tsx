'use client';
import { useState, useMemo, useEffect } from 'react';
import { useApp } from '@/context/AppContext';
import { getTransactions, saveTransactions, getFinanceSettings, saveFinanceSettings } from '@/lib/storage';
import { financeBalance, bankBalances, bankCurrencyLocal, rateForCurrency, bankAmountToDisplay } from '@/lib/calc';
import { formatMoney, formatDate, today } from '@/lib/utils';
import { BANKS, normalizeBank, bankLabel } from '@/lib/banks';
import { FinanceTypeBadge } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import TransactionForm from '@/components/forms/TransactionForm';
import ConfirmModal from '@/components/ui/ConfirmModal';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import { useConfirm } from '@/hooks/useConfirm';
import dynamic from 'next/dynamic';
const IncomeChart = dynamic(() => import('@/components/charts/IncomeChart'), { ssr: false, loading: () => null });
const BankBalancesChart = dynamic(() => import('@/components/charts/BankBalancesChart'), { ssr: false, loading: () => null });
import type { Transaction } from '@/types';

function getMonthKey(d?: string): string | null {
  if (!d) return null;
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}
function getMonthLabel(k: string) {
  const [y, m] = k.split('-');
  const months = ['Січ', 'Лют', 'Бер', 'Кві', 'Тра', 'Чер', 'Лип', 'Сер', 'Вер', 'Жов', 'Лис', 'Гру'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

export default function FinancePage() {
  const { refreshKey, triggerRefresh } = useApp();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [initialType, setInitialType] = useState<'income' | 'expense'>('income');
  const { isOpen: confirmOpen, title: confirmTitle, text: confirmText, confirm, handleConfirm, cancel } = useConfirm();
  const [mounted, setMounted] = useState(false);
  const [usdRate, setUsdRate] = useState('');
  const [eurRate, setEurRate] = useState('');
  const [usdtRate, setUsdtRate] = useState('');
  const [convFrom, setConvFrom] = useState('mono');
  const [convTo, setConvTo] = useState('cash');
  const [convAmount, setConvAmount] = useState('');
  useEffect(() => {
    setMounted(true);
    const s = getFinanceSettings();
    setUsdRate(String(s.usdRate));
    setEurRate(String(s.eurRate));
    setUsdtRate(String((s as any).usdtRate ?? s.usdRate));
  }, []);

  const allTxs = useMemo(() => (mounted ? getTransactions() : []), [mounted, refreshKey]);

  // Місяці, в яких реально є транзакції — для селекта
  const monthOptions = useMemo(() => {
    const keys = new Set<string>();
    allTxs.forEach(t => {
      if (t.hidden) return;
      const k = getMonthKey(t.date || t.plannedDate);
      if (k) keys.add(k);
    });
    return [...keys].sort().reverse();
  }, [allTxs]);

  const inPeriod = (t: Transaction) => {
    if (!periodFilter) return true;
    const dateStr = t.date || t.plannedDate;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    const now = new Date();
    if (periodFilter.startsWith('m:')) return getMonthKey(dateStr) === periodFilter.slice(2);
    switch (periodFilter) {
      case 'this_month':
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      case 'last_month': {
        const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return d.getFullYear() === prev.getFullYear() && d.getMonth() === prev.getMonth();
      }
      case 'this_year':
        return d.getFullYear() === now.getFullYear();
      case 'last_year':
        return d.getFullYear() === now.getFullYear() - 1;
      default:
        return true;
    }
  };

  const txs = useMemo(() => {
    if (!mounted) return [];
    return allTxs.filter(t => {
      if (t.hidden) return false;
      const bankL = bankLabel(normalizeBank(t.bank) || t.bank).toLowerCase();
      const ms = (t.description || '').toLowerCase().includes(search.toLowerCase()) || (t.category || '').toLowerCase().includes(search.toLowerCase()) || bankL.includes(search.toLowerCase());
      const mt = !typeFilter || t.type === typeFilter;
      const mp = inPeriod(t);
      return ms && mt && mp;
    }).sort((a, b) => new Date(b.date || b.plannedDate || '').getTime() - new Date(a.date || a.plannedDate || '').getTime());
  }, [mounted, refreshKey, search, typeFilter, periodFilter, allTxs]);

  // Підсумки по відфільтрованому списку
  const filteredSummary = useMemo(() => {
    let turnover = 0, income = 0, expense = 0;
    txs.forEach(t => {
      if (t.type === 'transfer') return;
      const v = bankAmountToDisplay(Number(t.amount) || 0, t.bank);
      if (t.type === 'income') {
        turnover += v;
        if (t.incomeStatus !== 'incoming') income += v;
      } else if (t.type === 'expense') {
        expense += v;
      }
    });
    return { count: txs.length, turnover, income, expense };
  }, [txs]);

  const balance = useMemo(() => mounted ? financeBalance(allTxs) : 0, [mounted, allTxs]);

  const chartData = useMemo(() => {
    if (!mounted) return { labels: [], income: [] };
    const md: Record<string, number> = {};
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      md[key] = 0;
    }
    allTxs.forEach(t => {
      if (t.source && String(t.source).startsWith('project_')) return;
      if (t.type !== 'income') return;
      if (t.incomeStatus === 'incoming') return;
      const key = getMonthKey(t.date || t.plannedDate);
      if (key && md[key] !== undefined) {
        md[key] += bankAmountToDisplay(t.amount, t.bank);
      }
    });
    return { labels: Object.keys(md).map(k => getMonthLabel(k)), income: Object.values(md) };
  }, [mounted, allTxs]);

  const balances = useMemo(() => mounted ? bankBalances(allTxs) : { mono: 0, privat: 0, cash: 0, cash_usd: 0, cash_eur: 0, crypto_usdt: 0 }, [mounted, allTxs]);

  const weekClass = (dateStr?: string) => {
    const d = new Date(dateStr || today());
    const day = (d.getDay() + 6) % 7;
    const monday = new Date(d); monday.setDate(d.getDate() - day); monday.setHours(0, 0, 0, 0);
    const wi = Math.floor(monday.getTime() / 604800000);
    return wi % 2 === 0 ? 'week-a' : 'week-b';
  };

  const formatBankAmount = (amount: number, bankId: string) => {
    const cur = bankCurrencyLocal(bankId);
    const v = Number(amount) || 0;
    if (cur === 'USD') return '$' + v.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
    if (cur === 'EUR') return '€' + v.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
    if (cur === 'USDT') return v.toLocaleString('uk-UA', { maximumFractionDigits: 2 }) + ' USDT';
    return formatMoney(v);
  };


  const handleSave = (data: Partial<Transaction>) => {
    const transactions = getTransactions();
    if (editTx) {
      const idx = transactions.findIndex(t => t.id === editTx.id);
      if (idx >= 0) transactions[idx] = { ...transactions[idx], ...data };
    } else {
      transactions.push({ id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5), ...data } as Transaction);
    }
    saveTransactions(transactions); setFormOpen(false); setEditTx(null); triggerRefresh();
  };

  const handleDelete = (id: string) => {
    confirm('Видалити транзакцію?', 'Транзакція буде видалена безповоротно.', () => {
      saveTransactions(getTransactions().filter(t => t.id !== id)); triggerRefresh();
    });
  };

  const saveRates = () => {
    saveFinanceSettings({ usdRate: Number(usdRate) || 41, eurRate: Number(eurRate) || 44, usdtRate: Number(usdtRate) || Number(usdRate) || 41 });
  };

  const doConversion = () => {
    saveRates();
    const amount = Number(convAmount) || 0;
    if (!convFrom || !convTo || convFrom === convTo || !amount) return;
    const fromCur = bankCurrencyLocal(convFrom);
    const toCur = bankCurrencyLocal(convTo);
    const uah = amount * rateForCurrency(fromCur);
    const target = uah / rateForCurrency(toCur);
    const transactions = getTransactions();
    transactions.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      type: 'transfer', bank: convFrom, toBank: convTo, amount, targetAmount: target,
      category: 'Конвертація', description: `${bankLabel(convFrom)} → ${bankLabel(convTo)}`,
      date: today(), status: 'done',
    });
    saveTransactions(transactions); setConvAmount(''); triggerRefresh();
  };

  return (
    <ErrorBoundary>
    <section className="page active">
      <div className="page-header">
        <div><h1 className="page-title">Фінанси</h1><p className="page-subtitle">My Money / Cashflow</p></div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => { setEditTx(null); setInitialType('expense'); setFormOpen(true); }}>+ Витрата</button>
          <button className="btn btn-primary" onClick={() => { setEditTx(null); setInitialType('income'); setFormOpen(true); }}>+ Дохід</button>
        </div>
      </div>

      <div className="finance-summary">
        <div className="stat-card"><div className="stat-info"><span className="stat-label">Баланс</span><span className="stat-value">{formatMoney(balance)}</span></div></div>
        <div className="finance-converter">
          <div className="converter-rates">
            <label><span>$</span><input type="number" className="form-input" value={usdRate} onChange={e => setUsdRate(e.target.value)} onBlur={saveRates} min="0" step="0.01" /></label>
            <label><span>€</span><input type="number" className="form-input" value={eurRate} onChange={e => setEurRate(e.target.value)} onBlur={saveRates} min="0" step="0.01" /></label>
            <label><span>USDT</span><input type="number" className="form-input" value={usdtRate} onChange={e => setUsdtRate(e.target.value)} onBlur={saveRates} min="0" step="0.01" /></label>
          </div>
          <div className="converter-flow">
            <select className="form-input" value={convFrom} onChange={e => setConvFrom(e.target.value)}>{BANKS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
            <span className="converter-arrow">→</span>
            <select className="form-input" value={convTo} onChange={e => setConvTo(e.target.value)}>{BANKS.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
            <input type="number" className="form-input" value={convAmount} onChange={e => setConvAmount(e.target.value)} min="0" step="0.01" placeholder="Сума" />
            <button className="btn btn-ghost" onClick={doConversion}>Конвертація</button>
          </div>
        </div>
      </div>

      <div className="charts-grid charts-grid--2">
        <div className="chart-card"><div className="chart-header"><h3 className="chart-title">Дохід по місяцях</h3></div><IncomeChart labels={chartData.labels} data={chartData.income} /></div>
        <div className="chart-card"><div className="chart-header"><h3 className="chart-title">Активи по банках</h3></div><BankBalancesChart balances={balances} usdtRate={Number(usdtRate) || Number(usdRate) || 41} /></div>
      </div>

      <div className="table-toolbar">
        <div className="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke="currentColor" strokeWidth="2"/></svg>
          <input type="text" className="search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Пошук транзакцій..." />
        </div>
        <select className="filter-select" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">Усі типи</option><option value="income">Дохід</option><option value="expense">Витрата</option><option value="transfer">Конвертація</option>
        </select>
        <select className="filter-select" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}>
          <option value="">Увесь час</option>
          <option value="this_month">Цього місяця</option>
          <option value="last_month">Минулого місяця</option>
          <option value="this_year">Цього року</option>
          <option value="last_year">Минулого року</option>
          {monthOptions.length > 0 && (
            <optgroup label="Конкретний місяць">
              {monthOptions.map(k => <option key={k} value={`m:${k}`}>{getMonthLabel(k)}</option>)}
            </optgroup>
          )}
        </select>
        {(typeFilter || periodFilter || search) && (
          <button className="btn btn-ghost" onClick={() => { setTypeFilter(''); setPeriodFilter(''); setSearch(''); }}>Скинути</button>
        )}
      </div>

      {(periodFilter || typeFilter) && txs.length > 0 && (
        <div className="stats-grid stats-grid--wide" style={{ marginBottom: 14 }}>
          <div className="stat-card"><div className="stat-info"><span className="stat-label">Транзакцій</span><span className="stat-value">{filteredSummary.count}</span></div></div>
          <div className="stat-card"><div className="stat-info"><span className="stat-label">Оборот</span><span className="stat-value" style={{ color: 'var(--accent-green)' }}>{formatMoney(Math.round(filteredSummary.turnover))}</span></div></div>
          <div className="stat-card"><div className="stat-info"><span className="stat-label">Витрати</span><span className="stat-value" style={{ color: 'var(--accent-orange)' }}>{formatMoney(Math.round(filteredSummary.expense))}</span></div></div>
          <div className="stat-card"><div className="stat-info"><span className="stat-label">Дохід</span><span className="stat-value" style={{ color: 'var(--accent-green)' }}>{formatMoney(Math.round(filteredSummary.income))}</span></div></div>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Тип</th><th>Сума</th><th>Банк</th><th>Категорія</th><th>Опис</th><th>Дата</th><th>Дії</th></tr></thead>
          <tbody>
            {!txs.length ? <tr className="empty-row"><td colSpan={7}><EmptyState message="Немає транзакцій" hint="Додайте дохід або витрату" /></td></tr> :
            txs.map(t => (
              <tr key={t.id} className={weekClass(t.date || t.plannedDate)}>
                <td data-label="Тип">{t.type === 'transfer' ? <span className="badge badge--blue">Конвертація</span> : <FinanceTypeBadge type={t.type} />}</td>
                {t.type === 'transfer' ? (
                  <td data-label="Сума" style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{formatBankAmount(t.amount, t.bank)} → {formatBankAmount(t.targetAmount ?? t.amount, t.toBank || '')}</td>
                ) : (
                  <td data-label="Сума" style={{ color: t.type === 'income' ? 'var(--accent-green)' : 'var(--accent-orange)', fontWeight: 600 }}>{t.type === 'income' ? '+' : '−'}{formatBankAmount(t.amount, t.bank)}</td>
                )}
                <td data-label="Банк">{t.type === 'transfer' ? <><span className={`badge badge--black`}>{bankLabel(normalizeBank(t.bank) || t.bank)}</span> → <span className={`badge badge--green`}>{bankLabel(normalizeBank(t.toBank || ''))}</span></> : <span className={`badge badge--${normalizeBank(t.bank) === 'mono' ? 'black' : 'green'}`}>{bankLabel(normalizeBank(t.bank) || t.bank)}</span>}</td>
                <td data-label="Категорія">{t.type === 'transfer' ? 'Конвертація' : (t.category || '—')}</td>
                <td data-label="Опис">{t.description || '—'}</td>
                <td data-label="Дата"><span className="week-date"><span className="week-dot"></span>{formatDate(t.date || t.plannedDate)}</span></td>
                <td data-label="Дії">
                  <div className="actions-cell">
                    {t.type !== 'transfer' && <button className="btn-icon btn-icon--edit" title="Редагувати" onClick={() => { setEditTx(t); setFormOpen(true); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" strokeWidth="2"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2"/></svg></button>}
                    <button className="btn-icon btn-icon--danger" title="Видалити" onClick={() => handleDelete(t.id)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2"/><path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2"/><path d="M9 6V4h6v2" stroke="currentColor" strokeWidth="2"/></svg></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TransactionForm isOpen={formOpen} transaction={editTx} initialType={initialType} onSave={handleSave} onCancel={() => { setFormOpen(false); setEditTx(null); }} />
      <ConfirmModal isOpen={confirmOpen} title={confirmTitle} text={confirmText} onConfirm={handleConfirm} onCancel={cancel} />
    </section>
    </ErrorBoundary>
  );
}
