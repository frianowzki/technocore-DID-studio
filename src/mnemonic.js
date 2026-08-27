import { BIP39_WORDLIST } from './bip39-wordlist.js';

const encoder = new TextEncoder();

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Identity seed must be exactly 64 hexadecimal characters.');
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function normalizePhrase(phrase) {
  if (typeof phrase !== 'string') throw new Error('Recovery phrase must be text.');
  // NFKD + collapse whitespace; BIP39 English words are ASCII so lowercasing is safe.
  return phrase.normalize('NFKD').trim().toLowerCase().split(/\s+/u).filter(Boolean);
}

async function checksumBits(entropy) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', entropy));
  // 32 bytes of entropy -> first 8 checksum bits.
  return digest[0];
}

// Encode a 32-byte (64-hex) Ed25519 seed as a 24-word BIP39 English mnemonic.
export async function seedToMnemonic(seedHex) {
  const entropy = hexToBytes(seedHex);
  if (entropy.length !== 32) throw new Error('Only 32-byte seeds map to a 24-word phrase.');
  const checksum = await checksumBits(entropy);
  // 256 entropy bits + 8 checksum bits = 264 bits = 24 * 11.
  let bitString = '';
  for (const byte of entropy) bitString += byte.toString(2).padStart(8, '0');
  bitString += checksum.toString(2).padStart(8, '0');
  const words = [];
  for (let index = 0; index < bitString.length; index += 11) {
    words.push(BIP39_WORDLIST[Number.parseInt(bitString.slice(index, index + 11), 2)]);
  }
  return words.join(' ');
}

// Decode a 24-word BIP39 phrase back to the 32-byte seed, verifying the checksum.
export async function mnemonicToSeed(phrase) {
  const words = normalizePhrase(phrase);
  if (words.length !== 24) throw new Error('Recovery phrase must contain exactly 24 words.');
  let bitString = '';
  for (const word of words) {
    const index = BIP39_WORDLIST.indexOf(word);
    if (index === -1) throw new Error(`"${word}" is not in the BIP39 English wordlist.`);
    bitString += index.toString(2).padStart(11, '0');
  }
  const entropyBits = bitString.slice(0, 256);
  const checksumProvided = Number.parseInt(bitString.slice(256), 2);
  const entropy = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    entropy[index] = Number.parseInt(entropyBits.slice(index * 8, index * 8 + 8), 2);
  }
  if (await checksumBits(entropy) !== checksumProvided) {
    throw new Error('Recovery phrase checksum is invalid; re-check the words and their order.');
  }
  return bytesToHex(entropy);
}
