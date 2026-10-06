import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearAll, bootStore, makeClient } from './helpers';
import * as store from '@/lib/store';
import { createDemoTransport, createNotConnectedTransport, getTransport } from '@/lib/assistant/transport';
import type { AssistantSendRequest } from '@/lib/assistant/contract';

function request(text: string): AssistantSendRequest {
  return { requestId: 'req_1', text, history: [], provider: 'openai', model: 'gpt-4o-mini' };
}

test('не підключений транспорт повертає not_connected і нічого не пише', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [makeClient()]);
  const before = store.getSnapshot();

  const transport = createNotConnectedTransport();
  const reply = await transport.send(request('створи клієнта Іван'));
  assert.equal(reply.kind, 'error');
  if (reply.kind === 'error') {
    assert.equal(reply.error.code, 'not_connected');
    assert.equal(reply.error.message, 'Помічник ще не підключений');
  }
  const confirm = await transport.confirm({ requestId: 'r', draftId: 'd' });
  assert.equal(confirm.kind, 'error');

  assert.equal(store.getSnapshot(), before, 'дані не змінювалися');
});

test('demo-режим не створює реальних записів', async () => {
  clearAll();
  await bootStore();
  await store.saveCollection('clients', [makeClient()]);
  const before = JSON.stringify(store.getSnapshot());

  const transport = createDemoTransport();
  const reply = await transport.send(request('створи клієнта Іван'));
  assert.ok(reply.kind === 'clarify' || reply.kind === 'draft' || reply.kind === 'text');

  const outcome = await transport.confirm({ requestId: 'r', draftId: 'd' });
  assert.equal(outcome.kind, 'demo');
  if (outcome.kind === 'demo') {
    assert.ok(outcome.summary.includes('не створено'));
  }

  assert.equal(JSON.stringify(store.getSnapshot()), before, 'жодного запису не додано');
});

test('скасування очікування повертає cancelled', async () => {
  const transport = createDemoTransport();
  const controller = new AbortController();
  controller.abort();
  const reply = await transport.send(request('покажи борги'), controller.signal);
  assert.equal(reply.kind, 'error');
  if (reply.kind === 'error') assert.equal(reply.error.code, 'cancelled');
});

test('вибір транспорту залежить від явного demo-прапорця', () => {
  assert.equal(getTransport({ provider: 'openai', model: 'm', demo: false }).id, 'not-connected');
  assert.equal(getTransport({ provider: 'openai', model: 'm', demo: true }).id, 'demo');
});
