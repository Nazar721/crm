import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kyivDateString, monthKeyOf, todayKyiv, calendarDaysBetween, ACCOUNTING_TIME_ZONE,
  formatKyivDate,
} from '@/lib/dates';
import { getMonthKey, daysBetween, formatDate, today } from '@/lib/utils';

test('облікова дата рахується за Europe/Kyiv', () => {
  assert.equal(ACCOUNTING_TIME_ZONE, 'Europe/Kyiv');
  // 22:30 31 березня UTC → 01:30 1 квітня у Києві.
  assert.equal(kyivDateString('2026-03-31T22:30:00.000Z'), '2026-04-01');
  assert.equal(monthKeyOf('2026-03-31T22:30:00.000Z'), '2026-04');
  // Дата-без-часу трактується як облікова дата.
  assert.equal(kyivDateString('2026-03-05'), '2026-03-05');
  assert.equal(monthKeyOf('2026-03-05'), '2026-03');
});

test('некоректні дати дають null, а не NaN-NaN', () => {
  assert.equal(kyivDateString(''), null);
  assert.equal(kyivDateString('not-a-date'), null);
  assert.equal(kyivDateString('2026-13-45'), null);
  assert.equal(getMonthKey('not-a-date'), null);
  assert.equal(getMonthKey(undefined), null);
  assert.equal(formatDate('not-a-date'), '—');
});

test('today() повертає облікову дату у форматі YYYY-MM-DD', () => {
  const value = todayKyiv();
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(today(), value);
});

test('рахунок днів використовує облікові дати', () => {
  assert.equal(calendarDaysBetween('2026-02-28', '2026-03-01'), 1);
  assert.equal(daysBetween('2026-02-28', '2026-03-01'), 1);
  assert.equal(daysBetween('2026-03-01', '2026-03-01'), 0);
  assert.equal(daysBetween('bad', '2026-03-01'), 0);
});
