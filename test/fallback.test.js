import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFallbackResponse } from '../src/fallback.js';

const signed = {
  did: 'did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd',
  nonce: '1720000000000',
  text: 'hello world',
};
const goodResponse = {
  room: 'lobby',
  posted: { seq: 42, ts: '2026-08-25T08:00:00Z', from: signed.did, nonce: 1720000000000, text: 'hello world' },
};

test('accepts a matching fallback response and normalizes it to a publication record', () => {
  const record = verifyFallbackResponse(JSON.stringify(goodResponse), signed, { room: 'lobby', origin: 'https://technocore.chat' });
  assert.deepEqual(record, {
    room: 'lobby', seq: 42, timestamp: '2026-08-25T08:00:00Z', did: signed.did, nonce: '1720000000000', text: 'hello world', origin: 'https://technocore.chat',
  });
});

test('rejects a response whose text does not match the signed message', () => {
  const bad = { ...goodResponse, posted: { ...goodResponse.posted, text: 'tampered' } };
  assert.throws(() => verifyFallbackResponse(bad, signed, { room: 'lobby' }), /text does not match/);
});

test('rejects a response signed by a different DID', () => {
  const bad = { ...goodResponse, posted: { ...goodResponse.posted, from: 'did:key:zOther' } };
  assert.throws(() => verifyFallbackResponse(bad, signed, { room: 'lobby' }), /different DID/);
});

test('rejects a mismatched nonce and a mismatched room', () => {
  assert.throws(() => verifyFallbackResponse({ ...goodResponse, posted: { ...goodResponse.posted, nonce: 999 } }, signed, { room: 'lobby' }), /nonce does not match/);
  assert.throws(() => verifyFallbackResponse(goodResponse, signed, { room: 'technocore' }), /room does not match/);
});

test('rejects malformed input and missing fields', () => {
  assert.throws(() => verifyFallbackResponse('not json', signed, {}), /exact JSON/);
  assert.throws(() => verifyFallbackResponse('{"room":"lobby"}', signed, {}), /missing the expected/);
  assert.throws(() => verifyFallbackResponse(JSON.stringify(goodResponse), null, {}), /Sign a message/);
});

test('rejects an invalid sequence or timestamp', () => {
  assert.throws(() => verifyFallbackResponse({ ...goodResponse, posted: { ...goodResponse.posted, seq: 0 } }, signed, {}), /sequence is invalid/);
  assert.throws(() => verifyFallbackResponse({ ...goodResponse, posted: { ...goodResponse.posted, ts: 'nope' } }, signed, {}), /timestamp is invalid/);
});
