import test from 'node:test';
import assert from 'node:assert/strict';
import { mnemonicToSeed, seedToMnemonic } from '../src/mnemonic.js';
import { createDid } from '../src/crypto.js';

// Authoritative BIP39 English test vectors (32-byte entropy -> 24 words).
const ZERO_SEED = '0000000000000000000000000000000000000000000000000000000000000000';
const ZERO_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';
const FF_SEED = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const FF_PHRASE = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote';

test('encodes 32-byte seeds to the canonical 24-word BIP39 phrase', async () => {
  assert.equal(await seedToMnemonic(ZERO_SEED), ZERO_PHRASE);
  assert.equal(await seedToMnemonic(FF_SEED), FF_PHRASE);
});

test('round-trips a phrase back to the same seed and DID', async () => {
  const seed = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
  const phrase = await seedToMnemonic(seed);
  assert.equal(phrase.split(' ').length, 24);
  assert.equal(await mnemonicToSeed(phrase), seed);
  assert.equal(await createDid(await mnemonicToSeed(phrase)), 'did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd');
});

test('normalizes casing and spacing before decoding', async () => {
  assert.equal(await mnemonicToSeed(`  ${ZERO_PHRASE.toUpperCase()}  `), ZERO_SEED);
});

test('rejects wrong length, unknown words, and bad checksums', async () => {
  await assert.rejects(mnemonicToSeed('abandon abandon art'), /exactly 24 words/);
  await assert.rejects(mnemonicToSeed(ZERO_PHRASE.replace('art', 'notaword')), /not in the BIP39/);
  const words = ZERO_PHRASE.split(' ');
  words[0] = 'ability'; // valid word, breaks the checksum
  await assert.rejects(mnemonicToSeed(words.join(' ')), /checksum is invalid/);
});
