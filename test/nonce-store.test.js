import test from 'node:test';
import assert from 'node:assert/strict';
import { highestNonce, nextNonceFor, rememberNonce } from '../src/nonce-store.js';

const DID = 'did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd';
const OTHER = 'did:key:z6Mkoooooooooooooooooooooooooooooooooooooooooooo';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    _data: data,
  };
}

test('prefers the clock when it is ahead of the stored high-water mark', () => {
  const storage = memoryStorage();
  rememberNonce(DID, 'lobby', '100', storage);
  const next = nextNonceFor(DID, 'lobby', { storage, now: () => 5000 });
  assert.equal(next, '5000');
});

test('bumps past the stored nonce when the clock has not advanced', () => {
  const storage = memoryStorage();
  rememberNonce(DID, 'lobby', '9000', storage);
  // clock behind stored value -> stored + 1
  const next = nextNonceFor(DID, 'lobby', { storage, now: () => 100 });
  assert.equal(next, '9001');
});

test('remembers only the maximum nonce per DID and room', () => {
  const storage = memoryStorage();
  rememberNonce(DID, 'lobby', '500', storage);
  rememberNonce(DID, 'lobby', '200', storage); // lower, ignored
  rememberNonce(DID, 'lobby', '900', storage);
  assert.equal(highestNonce(DID, 'lobby', storage), '900');
});

test('keeps nonce high-water marks isolated by room and by DID', () => {
  const storage = memoryStorage();
  rememberNonce(DID, 'lobby', '700', storage);
  rememberNonce(DID, 'technocore', '10', storage);
  assert.equal(highestNonce(DID, 'lobby', storage), '700');
  assert.equal(highestNonce(DID, 'technocore', storage), '10');
  assert.equal(highestNonce(OTHER, 'lobby', storage), null);
});

test('ignores malformed nonces and non-DID keys', () => {
  const storage = memoryStorage();
  rememberNonce(DID, 'lobby', 'not-a-nonce', storage);
  rememberNonce('not-a-did', 'lobby', '5', storage);
  assert.equal(highestNonce(DID, 'lobby', storage), null);
});

test('never stores private material', () => {
  const storage = memoryStorage();
  rememberNonce(DID, 'lobby', '123', storage);
  const dump = JSON.stringify([...storage._data.entries()]);
  assert.equal(dump.includes('seed'), false);
  assert.equal(dump.includes('passphrase'), false);
});
