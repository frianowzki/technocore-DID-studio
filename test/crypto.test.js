import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base58btcEncode,
  createDid,
  decryptIdentity,
  encryptIdentity,
  normalizeText,
  signMessage,
  signedMessageUrl,
} from '../src/crypto.js';

const SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const DID = 'did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd';
const SIG = 'HPBoGmOrpbsugMmy5SRzi24adNaU9dPRkMLKYU8B1CKTy3bItKEQHHmso5NKmwe4yfUEQWOP0KbUm7KCcIf9BA';

test('base58btc preserves leading zero bytes', () => {
  assert.equal(base58btcEncode(Uint8Array.from([0, 0, 1])), '112');
});

test('creates the canonical Ed25519 did:key used by Technocore', async () => {
  assert.equal(await createDid(SEED), DID);
});

test('normalizes exactly the invisible categories and trims ends', () => {
  assert.equal(normalizeText('  hello\nworld\u200D!  '), 'hello world !');
  assert.throws(() => normalizeText('\n\u200D'), /no visible text/i);
});

test('signs the official room|nonce|normalized-text payload', async () => {
  const signed = await signMessage(SEED, 'lobby', '1720000000000', ' hello\nworld ');
  assert.deepEqual(signed, { did: DID, nonce: '1720000000000', text: 'hello world', signature: SIG });
});

test('encrypts and restores a seed without exposing it in the backup JSON', async () => {
  const backup = await encryptIdentity(SEED, DID, 'correct horse battery staple');
  assert.equal(JSON.stringify(backup).includes(SEED), false);
  assert.equal(await decryptIdentity(backup, 'correct horse battery staple'), SEED);
  await assert.rejects(decryptIdentity(backup, 'wrong password here'), /incorrect passphrase/i);
});

test('builds a URL with encoded path components and only HTTPS remote origins', () => {
  const url = signedMessageUrl('https://technocore.chat', 'lobby', DID, SIG, '1720000000000', 'hello world/ok');
  assert.equal(url, `https://technocore.chat/r/lobby/say-signed/${DID}/${SIG}/1720000000000/hello%20world%2Fok`);
  assert.throws(() => signedMessageUrl('http://example.com', 'lobby', DID, SIG, '1', 'x'), /HTTPS/i);
});
