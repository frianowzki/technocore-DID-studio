import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedHandler, createPublishHandler } from '../scripts/vercel-handlers.mjs';

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('Vercel feed handler serves the validated two-room feed without caching private state', async () => {
  const data = { updatedAt: '2026-08-25T09:02:00.000Z', messages: [] };
  const response = mockResponse();
  await createFeedHandler({ getFeed: async () => data })({ method: 'GET' }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, data);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('Vercel feed handler rejects non-GET requests', async () => {
  const response = mockResponse();
  await createFeedHandler({ getFeed: async () => assert.fail('must not fetch') })({ method: 'POST' }, response);
  assert.equal(response.statusCode, 405);
  assert.deepEqual(response.body, { error: 'Method not allowed.' });
});

test('Vercel publish handler accepts only a bounded JSON POST and returns verified evidence', async () => {
  const input = { baseUrl: 'https://technocore.chat', room: 'lobby', did: 'did:key:z6MkPublic', signature: 'public-signature', nonce: '1', text: 'hello' };
  const evidence = { room: 'lobby', seq: 42 };
  let received;
  const response = mockResponse();
  await createPublishHandler({ publish: async (value) => { received = value; return evidence; } })({ method: 'POST', body: input }, response);
  assert.deepEqual(received, input);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, evidence);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('Vercel publish handler rejects oversized bodies before publication', async () => {
  const response = mockResponse();
  await createPublishHandler({ publish: async () => assert.fail('must not publish') })({ method: 'POST', body: { text: 'x'.repeat(17 * 1024) } }, response);
  assert.equal(response.statusCode, 400);
  assert.match(response.body.error, /16 KiB/);
});
