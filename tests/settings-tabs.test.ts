import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_TABS,
  DEFAULT_SETTINGS_TAB,
  normalizeSettingsTabId,
  isSettingsTabId,
  getSettingsTab,
} from '@/lib/settings-tabs';

test('реєстр вкладок налаштувань: чотири базові вкладки без дублів', () => {
  const ids = SETTINGS_TABS.map(t => t.id);
  assert.deepEqual(ids, ['finance', 'assistant', 'backup', 'system']);
  assert.equal(new Set(ids).size, ids.length, 'ID вкладок унікальні');
  for (const tab of SETTINGS_TABS) {
    assert.ok(tab.label.length > 0, `вкладка ${tab.id} має підпис`);
  }
});

test('нормалізація вкладки: невідома → базова finance', () => {
  assert.equal(normalizeSettingsTabId('finance'), 'finance');
  assert.equal(normalizeSettingsTabId('system'), 'system');
  assert.equal(normalizeSettingsTabId('hosting'), DEFAULT_SETTINGS_TAB);
  assert.equal(normalizeSettingsTabId(''), DEFAULT_SETTINGS_TAB);
  assert.equal(normalizeSettingsTabId(null), DEFAULT_SETTINGS_TAB);
  assert.equal(normalizeSettingsTabId(undefined), DEFAULT_SETTINGS_TAB);
  assert.equal(DEFAULT_SETTINGS_TAB, 'finance');
});

test('гард і гетер вкладки не кидають на смітті', () => {
  assert.equal(isSettingsTabId('backup'), true);
  assert.equal(isSettingsTabId('потрапило-з-URL'), false);
  assert.equal(isSettingsTabId(42), false);
  assert.equal(getSettingsTab('assistant').id, 'assistant');
  assert.equal(getSettingsTab(normalizeSettingsTabId('щось-нове-з-майбутнього-пакета')).id, 'finance');
});
