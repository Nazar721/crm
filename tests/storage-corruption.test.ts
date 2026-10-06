import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, bootStore, makeClient } from './helpers';
import * as store from '@/lib/store';
import { getIssues } from '@/lib/store';

test('пошкоджений JSON не підміняється мовчки: фіксується, кварантується, запис блокується', async () => {
  clearAll();
  localStorage.setItem('clients', '{не json');
  localStorage.setItem('transactions', '"рядок замість масиву"');

  await bootStore();

  const snapshot = store.getSnapshot();
  assert.deepEqual(snapshot.clients, []);
  assert.deepEqual(snapshot.transactions, []);

  const issues = getIssues();
  const corrupt = issues.filter(i => i.kind === 'corrupt_json');
  assert.equal(corrupt.length, 2, 'обидва пошкоджені ключі мають бути зафіксовані');
  assert.ok(corrupt.every(i => !!i.preservedAt), 'оригінал має бути збережено окремо');
  assert.ok(corrupt.every(i => i.collection === 'clients' || i.collection === 'transactions'),
    'issue має вказувати колекцію');

  // Оригінальні байти не втрачено.
  assert.equal(localStorage.getItem('crm_corrupt_clients'), '{не json');
  assert.equal(localStorage.getItem('crm_corrupt_transactions'), '"рядок замість масиву"');

  // Колекція позначена пошкодженою — звичайний запис заблоковано.
  assert.deepEqual(store.getCorruptCollections().sort(), ['clients', 'transactions']);
  const blocked = await store.saveCollection('clients', [makeClient()]);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.ok(blocked.issue.message.includes('пошкоджені дані'), blocked.issue.message);
    assert.ok(blocked.issue.message.includes('відновлення'), blocked.issue.message);
  }

  // Відновлення через явний імпорт (import scope) дозволене.
  const recovered = await store.saveCollection('clients', [makeClient()], 'import');
  assert.equal(recovered.ok, true);
  assert.equal(store.isCollectionCorrupt('clients'), false);
  assert.equal(store.getSnapshot().clients.length, 1);
});

test('недоступне сховище дає явний стан помилки, а не порожні дані', async () => {
  clearAll();
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new Error('storage disabled'); },
  });
  try {
    await store.initStore();
    assert.equal(store.getStoreStatus(), 'error');
    assert.ok(store.getStoreError());
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: original,
    });
  }
});
