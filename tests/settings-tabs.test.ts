import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETTINGS_TABS,
  DEFAULT_SETTINGS_TAB,
  normalizeSettingsTabId,
  isSettingsTabId,
  getSettingsTab,
  parseSettingsTabFromSearch,
  resolveSettingsTab,
  settingsTabHref,
  syncRatesDraft,
  isRatesDraftDirty,
  CLEAN_RATES_DIRTY,
} from '@/lib/settings-tabs';
import { loadProviderSettings, saveProviderSettings } from '@/lib/assistant/prefs';

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

test('P2: URL має пріоритет; невідомий tab ігнорується', () => {
  assert.equal(parseSettingsTabFromSearch('?tab=backup'), 'backup');
  assert.equal(parseSettingsTabFromSearch('tab=assistant'), 'assistant');
  assert.equal(parseSettingsTabFromSearch('?tab=hosting'), null);
  assert.equal(parseSettingsTabFromSearch('?tab='), null);
  assert.equal(parseSettingsTabFromSearch(null), null);
  assert.equal(parseSettingsTabFromSearch(''), null);

  // Валідний query перемагає збережену вкладку.
  assert.equal(resolveSettingsTab({ search: '?tab=backup', stored: 'assistant' }), 'backup');
  // Невідомий query → fallback на sessionStorage.
  assert.equal(resolveSettingsTab({ search: '?tab=hosting', stored: 'assistant' }), 'assistant');
  // Нічого немає → базова.
  assert.equal(resolveSettingsTab({ search: '', stored: 'щось-ліве' }), 'finance');
  // Fallback без доступу до sessionStorage (виняток у читанні зверху):
  // resolve приймає вже прочитане значення, null → базова.
  assert.equal(resolveSettingsTab({ search: null, stored: null }), 'finance');

  assert.equal(settingsTabHref('backup'), '/settings?tab=backup');
  assert.equal(settingsTabHref(normalizeSettingsTabId('hosting')), '/settings?tab=finance');
});

test('P2: чернетка курсів не затирає редаговані поля при оновленні snapshot', () => {
  const snap = { usdRate: 41, eurRate: 44, usdtRate: 41 };
  // Чисті поля підтягують актуальні значення…
  assert.deepEqual(
    syncRatesDraft({ usdRate: '', eurRate: '', usdtRate: '' }, snap, CLEAN_RATES_DIRTY),
    { usdRate: '41', eurRate: '44', usdtRate: '41' },
  );
  // …а брудне (редаговане USD=47) лишається, навіть коли snapshot оновився
  // через зміну displayCurrency поруч.
  const draft = { usdRate: '47', eurRate: '44', usdtRate: '41' };
  assert.deepEqual(
    syncRatesDraft(draft, { usdRate: 42, eurRate: 44, usdtRate: 42 }, { usd: true, eur: false, usdt: false }),
    { usdRate: '47', eurRate: '44', usdtRate: '42' },
  );
  assert.equal(isRatesDraftDirty(draft, snap), true);
  assert.equal(isRatesDraftDirty({ usdRate: '41', eurRate: '44', usdtRate: '41' }, snap), false);
});

test('P1: збережений профіль провайдера переживає цикл читання/запису', () => {
  localStorage.clear();
  // Сценарій огляду: збережено opencode + demo → форма має показати
  // саме це, а не типові openrouter/free.
  const saved = saveProviderSettings({
    provider: 'opencode',
    model: 'mimo-v2.6-flash-free',
    baseUrl: undefined,
    demo: true,
  });
  assert.equal(saved.provider, 'opencode');
  assert.equal(saved.demo, true);

  const loaded = loadProviderSettings();
  assert.equal(loaded.provider, 'opencode');
  assert.equal(loaded.model, 'mimo-v2.6-flash-free');
  assert.equal(loaded.demo, true);

  // Повторне відкриття вкладки читає той самий профіль (без дрейфу до типових).
  assert.deepEqual(loadProviderSettings(), loaded);

  // Збереження з /assistant видно з вкладки налаштувань: той самий ключ.
  saveProviderSettings({ ...loaded, provider: 'openai', model: 'gpt-4o-mini' });
  assert.equal(loadProviderSettings().provider, 'openai');
  assert.equal(loadProviderSettings().model, 'gpt-4o-mini');

  // Ключ із поля перевірки формату в сховище не потрапляє.
  const raw = localStorage.getItem('crm_assistant_provider') || '';
  assert.equal(/sk-|api[_-]?key|secret/i.test(raw), false);
  localStorage.clear();
});
