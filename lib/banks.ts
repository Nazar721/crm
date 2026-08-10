import type { Bank } from '@/types';

export const BANKS: Bank[] = [
  { id: 'mono', label: 'Monobank', currency: 'UAH', badge: 'badge--black', chartColor: 'rgba(28, 28, 28, 0.92)', borderColor: '#666' },
  { id: 'privat', label: 'PrivatBank', currency: 'UAH', badge: 'badge--green', chartColor: 'rgba(52, 211, 153, 0.65)', borderColor: '#34d399' },
  { id: 'cash', label: 'Готівка ₴', currency: 'UAH', badge: 'badge--paper', chartColor: 'rgba(212, 196, 168, 0.75)', borderColor: '#d4c4a8' },
  { id: 'cash_usd', label: 'Готівка $', currency: 'USD', badge: 'badge--green', chartColor: 'rgba(45, 212, 191, 0.65)', borderColor: '#2dd4bf' },
  { id: 'cash_eur', label: 'Готівка €', currency: 'EUR', badge: 'badge--blue', chartColor: 'rgba(96, 165, 250, 0.62)', borderColor: '#60a5fa' },
];

export function normalizeBank(value?: string): string {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return '';
  if (v === 'mono' || v.includes('monobank') || v.includes('моно')) return 'mono';
  if (v === 'privat' || v.includes('privatbank') || v.includes('приват')) return 'privat';
  if (v === 'cash_usd' || v.includes('готівка $') || v.includes('cash usd') || v.includes('usd')) return 'cash_usd';
  if (v === 'cash_eur' || v.includes('готівка €') || v.includes('cash eur') || v.includes('eur')) return 'cash_eur';
  if (v === 'cash' || v.includes('готів') || v.includes('gotiv')) return 'cash';
  return String(value || '').trim();
}

export function bankLabel(id: string): string {
  return BANKS.find(b => b.id === id)?.label || id || '—';
}

export function bankCurrency(bankId: string): string {
  const bank = normalizeBank(bankId);
  if (bank === 'cash_usd') return 'USD';
  if (bank === 'cash_eur') return 'EUR';
  return 'UAH';
}
