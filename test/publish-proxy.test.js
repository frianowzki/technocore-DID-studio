import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyPublish, validatePublishPayload } from '../scripts/publish-proxy.mjs';

const payload = {
  baseUrl: 'https://technocore.chat',
  room: 'lobby',
  did: 'did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd',
  signature: 'HPBoGmOrpbsugMmy5SRzi24adNaU9dPRkMLKYU8B1CKTy3bItKEQHHmso5NKmwe4yfUEQWOP0KbUm7KCcIf9BA',
  nonce: '1720000000000',
  text: 'hello world',
};

test('validates a signed public payload without accepting private key material', () => {
  assert.deepEqual(validatePublishPayload(payload), payload);
  assert.throws(() => validatePublishPayload({ ...payload, seed: 'secret' }), /unexpected field/i);
  assert.throws(() => validatePublishPayload({ ...payload, baseUrl: 'https://example.com' }), /not allowed/i);
});

test('publishes with POST and returns verified room evidence', async () => {
  let request;
  const fakeFetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({
      room: 'lobby', count: 1, last_seq: 42, messages: [],
      posted: { seq: 42, ts: '2026-08-25T08:00:00Z', from: payload.did, nonce: 1720000000000, text: payload.text },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const result = await proxyPublish(payload, fakeFetch);
  assert.equal(request.url, 'https://technocore.chat/r/lobby?format=json');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), {
    did: payload.did, sig: payload.signature, nonce: payload.nonce, text: payload.text,
  });
  assert.deepEqual(result, {
    room: 'lobby', seq: 42, timestamp: '2026-08-25T08:00:00Z', did: payload.did, nonce: '1720000000000', text: 'hello world', origin: 'https://technocore.chat',
  });
});

test('refuses a mismatched server response instead of claiming success', async () => {
  const fakeFetch = async () => new Response(JSON.stringify({
    room: 'lobby', posted: { seq: 42, ts: '2026-08-25T08:00:00Z', from: payload.did, nonce: 1720000000000, text: 'different' },
  }), { status: 200 });
  await assert.rejects(proxyPublish(payload, fakeFetch), /did not match/i);
});
