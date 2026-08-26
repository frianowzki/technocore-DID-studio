import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base58btcEncode,
  createDid,
  decryptIdentity,
  decryptPortableBackup,
  decryptSeedBackup,
  encryptIdentity,
  encryptSeedBackup,
  normalizeText,
  nextNonceAfter,
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

test('advances a nonce beyond both the clock and the rejected value', () => {
  assert.equal(nextNonceAfter('1787723337906', 1787723337906), '1787723337907');
  assert.equal(nextNonceAfter('100', 200), '200');
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

test('creates a separate passphrase-encrypted seed-only backup', async () => {
  const backup = await encryptSeedBackup(SEED, DID, 'a different seed backup passphrase');
  const serialized = JSON.stringify(backup);
  assert.equal(backup.format, 'technocore-seed-backup');
  assert.equal(backup.did, DID);
  assert.equal(serialized.includes(SEED), false);
  assert.equal(serialized.includes('a different seed backup passphrase'), false);
  assert.equal(await decryptSeedBackup(backup, 'a different seed backup passphrase'), SEED);
  await assert.rejects(decryptSeedBackup(backup, 'incorrect seed passphrase'), /incorrect passphrase/i);
});

test('restores either portable backup format through one entry point', async () => {
  const identity = await encryptIdentity(SEED, DID, 'identity backup passphrase');
  const seedOnly = await encryptSeedBackup(SEED, DID, 'seed only backup passphrase');
  assert.deepEqual(await decryptPortableBackup(identity, 'identity backup passphrase'), { seed: SEED, did: DID, format: 'technocore-did-studio' });
  assert.deepEqual(await decryptPortableBackup(seedOnly, 'seed only backup passphrase'), { seed: SEED, did: DID, format: 'technocore-seed-backup' });
  await assert.rejects(decryptPortableBackup({ format: 'unknown' }, 'anything long enough'), /unsupported backup format/i);
});

test('builds a URL with encoded path components and only HTTPS remote origins', () => {
  const url = signedMessageUrl('https://technocore.chat', 'lobby', DID, SIG, '1720000000000', 'hello world/ok');
  assert.equal(url, `https://technocore.chat/r/lobby/say-signed/${DID}/${SIG}/1720000000000/hello%20world%2Fok`);
  assert.throws(() => signedMessageUrl('http://example.com', 'lobby', DID, SIG, '1', 'x'), /HTTPS/i);
});
