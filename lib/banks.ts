import type { Bank } from '@/types';

export const BANKS: Bank[] = [
  { id: 'mono', label: 'Monobank', currency: 'UAH', badge: 'badge--bank-mono', chartColor: 'rgba(192, 200, 213, 0.48)', borderColor: '#C0C8D5' },
  { id: 'privat', label: 'PrivatBank', currency: 'UAH', badge: 'badge--bank-privat', chartColor: 'rgba(0, 166, 80, 0.58)', borderColor: '#00A650' },
  { id: 'cash', label: 'Готівка ₴', currency: 'UAH', badge: 'badge--bank-cash', chartColor: 'rgba(218, 170, 88, 0.58)', borderColor: '#DAAA58' },
  { id: 'cash_usd', label: 'Готівка $', currency: 'USD', badge: 'badge--bank-usd', chartColor: 'rgba(67, 154, 255, 0.56)', borderColor: '#439AFF' },
  { id: 'cash_eur', label: 'Готівка €', currency: 'EUR', badge: 'badge--bank-eur', chartColor: 'rgba(126, 140, 255, 0.56)', borderColor: '#7E8CFF' },
  { id: 'crypto_usdt', label: 'Крипта USDT', currency: 'USDT', badge: 'badge--bank-usdt', chartColor: 'rgba(38, 161, 123, 0.56)', borderColor: '#26A17B' },
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
