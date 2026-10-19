import type { Bank } from '@/types';

export const BANKS: Bank[] = [
  { id: 'mono', label: 'Monobank', currency: 'UAH', badge: 'badge--black', chartColor: 'rgba(112, 116, 124, 0.85)', borderColor: '#8E92A0' },
  { id: 'privat', label: 'PrivatBank', currency: 'UAH', badge: 'badge--green', chartColor: 'rgba(101, 214, 161, 0.65)', borderColor: '#65D6A1' },
  { id: 'cash', label: 'Готівка ₴', currency: 'UAH', badge: 'badge--paper', chartColor: 'rgba(232, 189, 105, 0.70)', borderColor: '#E8BD69' },
  { id: 'cash_usd', label: 'Готівка $', currency: 'USD', badge: 'badge--green', chartColor: 'rgba(172, 172, 187, 0.70)', borderColor: '#ACACBB' },
  { id: 'cash_eur', label: 'Готівка €', currency: 'EUR', badge: 'badge--blue', chartColor: 'rgba(255, 129, 86, 0.62)', borderColor: '#FF8156' },
  { id: 'crypto_usdt', label: 'Крипта USDT', currency: 'USDT', badge: 'badge--teal', chartColor: 'rgba(142, 146, 160, 0.75)', borderColor: '#8E92A0' },
];

export function normalizeBank(value?: string): string {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return '';
  if (v === 'mono' || v.includes('monobank') || v.includes('моно')) return 'mono';
  if (v === 'privat' || v.includes('privatbank') || v.includes('приват')) return 'privat';
  if (v === 'crypto_usdt' || v === 'crypto' || v.includes('usdt') || v.includes('tether') || v.includes('крипт') || v.includes('crypto_usdt')) return 'crypto_usdt';
  if (v === 'cash_usd' || v.includes('готівка $') || v.includes('cash usd') || (v.includes('usd') && !v.includes('usdt'))) return 'cash_usd';
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
  if (bank === 'crypto_usdt') return 'USDT';
  return 'UAH';
}
