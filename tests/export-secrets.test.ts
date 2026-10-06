import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, bootStore, makeClient, makeTransaction } from './helpers';
import * as store from '@/lib/store';
import { buildExportPayload, stripSecrets, serializeExport } from '@/lib/export';
import { saveProviderSettings, checkKeyFormat, assertNoStoredSecrets, loadProviderSettings } from '@/lib/assistant/prefs';

const SECRET_PATTERN = /(api[_-]?key|apikey|secret|token|password|passwd|authorization|credential|private[_-]?key)/i;

test('повний експорт містить усі записи, версію, дати та зв’язки', async () => {
  clearAll();
  await bootStore();
  const client = makeClient();
  await store.saveCollection('clients', [client]);
  await store.saveCollection('projectsActive', [{
    id: 'p1', name: 'Проєкт', type: 'IT', status: 'В роботі', startDate: '2026-01-01',
    clientId: client.id, clientName: client.name, budget: 10, prepayment: 0,
    paidToSpecialist: 0, myPercent: 50, profitTaken: 0, fop: 0, partnerCommission: 0,
  }]);
  await store.saveCollection('transactions', [makeTransaction()]);

  const payload = buildExportPayload(store.getSnapshot());
  assert.equal(payload.app, 'WebAgency CRM');
  assert.ok(payload.version >= 1);
  assert.ok(payload.exportedAt);
  assert.equal(payload.data.clients.length, 1);
  assert.equal(payload.data.projectsActive.length, 1);
  assert.equal(payload.data.projectsActive[0].clientId, client.id);
  assert.equal(payload.data.transactions.length, 1);
  assert.ok(payload.financeSettings.usdRate > 0);
  assert.ok(payload.meta, 'meta з датами має бути у файлі');

  const roundTripped = JSON.parse(serializeExport(payload));
  assert.equal(roundTripped.data.clients[0].id, client.id);
});

test('секрети не потрапляють у payload експорту', () => {
  const dirty = {
    apiKey: 'sk-secret-value',
    nested: { client_secret: 'abc', ok: 'yes' },
    list: [{ token: 'zzz', keep: 1 }],
  };
  const clean = stripSecrets(dirty) as Record<string, unknown>;
  assert.equal('apiKey' in clean, false);
  assert.equal('client_secret' in (clean.nested as Record<string, unknown>), false);
  assert.equal('token' in (clean.list as unknown as Record<string, unknown>[])[0], false);
  assert.equal((clean.list as unknown as Record<string, unknown>[])[0].keep, 1);

  const json = JSON.stringify(clean);
  assert.equal(SECRET_PATTERN.test(json) && json.includes('sk-secret-value'), false);
});

test('API-ключ не зберігається у локальному сховищі', async () => {
  clearAll();
  await bootStore();

  const settings = saveProviderSettings({
    provider: 'openai',
    model: 'gpt-4o-mini',
    demo: false,
    // Спроба «протягнути» ключ — має бути відсіяно.
    ...({ apiKey: 'sk-super-secret', api_key: 'sk-super-secret' } as object),
  } as never);

  const stored = localStorage.getItem('crm_assistant_provider');
  assert.ok(stored);
  assert.equal(stored!.includes('sk-super-secret'), false);
  assert.equal('apiKey' in (settings as object), false);
  assert.equal(assertNoStoredSecrets().length, 0);
  assert.equal(loadProviderSettings().model, 'gpt-4o-mini');
});

test('перевірка ключа локальна і нічого не зберігає', () => {
  localStorage.clear();
  const bad = checkKeyFormat({ provider: 'openai', key: 'short' });
  assert.equal(bad.ok, false);
  assert.equal(bad.persisted, false);

  const good = checkKeyFormat({ provider: 'openai', key: 'sk-test-key-1234567890' });
  assert.equal(good.ok, true);
  assert.equal(good.persisted, false);
  assert.equal(localStorage.getItem('crm_assistant_provider'), null);
});
