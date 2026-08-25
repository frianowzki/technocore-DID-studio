import * as ed from '@noble/ed25519';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MULTICODEC_ED25519 = Uint8Array.from([0xed, 0x01]);
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const NONCE_RE = /^[0-9]{1,19}$/;
const DID_RE = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const SIG_RE = /^[A-Za-z0-9_-]{86}$/;
const INVISIBLE_RE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;
const PBKDF2_ITERATIONS = 310_000;
const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Identity seed must be exactly 64 hexadecimal characters.');
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

function base64urlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64urlDecode(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function base58btcEncode(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  let number = 0n;
  for (const byte of bytes) number = number * 256n + BigInt(byte);
  let encoded = '';
  while (number > 0n) {
    const remainder = Number(number % 58n);
    encoded = B58[remainder] + encoded;
    number /= 58n;
  }
  return '1'.repeat(leadingZeroes) + encoded;
}

export async function createDid(seedHex) {
  const publicKey = await ed.getPublicKeyAsync(hexToBytes(seedHex));
  const data = new Uint8Array(MULTICODEC_ED25519.length + publicKey.length);
  data.set(MULTICODEC_ED25519);
  data.set(publicKey, MULTICODEC_ED25519.length);
  const did = `did:key:z${base58btcEncode(data)}`;
  if (!DID_RE.test(did)) throw new Error('Generated key is not a canonical Ed25519 did:key.');
  return did;
}

export function generateSeed() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export function normalizeText(text, limit = 4096) {
  if (typeof text !== 'string') throw new Error('Message text must be a string.');
  const normalized = text.replace(INVISIBLE_RE, ' ').trim();
  if (!normalized) throw new Error('Message has no visible text after normalization.');
  const length = Array.from(normalized).length;
  if (length > limit) throw new Error(`Message has ${length} characters; maximum is ${limit}.`);
  return normalized;
}

function validateRoom(room) {
  if (!NAME_RE.test(room)) throw new Error('Room must match ^[a-z0-9][a-z0-9_-]{0,47}$.');
  return room;
}

function validateNonce(nonce) {
  const value = String(nonce);
  if (!NONCE_RE.test(value)) throw new Error('Nonce must contain 1–19 ASCII digits.');
  return value;
}

export function nextNonce() {
  return String(Date.now());
}

export async function signMessage(seedHex, room, nonce, text) {
  const validRoom = validateRoom(room);
  const validNonce = validateNonce(nonce);
  const normalized = normalizeText(text);
  const did = await createDid(seedHex);
  const signature = base64urlEncode(await ed.signAsync(encoder.encode(`${validRoom}|${validNonce}|${normalized}`), hexToBytes(seedHex)));
  if (!SIG_RE.test(signature)) throw new Error('Generated signature has an invalid encoding.');
  return { did, nonce: validNonce, text: normalized, signature };
}

async function deriveEncryptionKey(passphrase, salt, usage) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

export async function encryptIdentity(seedHex, did, passphrase) {
  if (typeof passphrase !== 'string' || Array.from(passphrase).length < 12) {
    throw new Error('Passphrase must contain at least 12 characters.');
  }
  if (!DID_RE.test(did) || await createDid(seedHex) !== did) throw new Error('DID does not match the identity seed.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(passphrase, salt, ['encrypt']);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(did) }, key, hexToBytes(seedHex));
  return {
    format: 'technocore-did-studio',
    version: 1,
    did,
    crypto: {
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      cipher: 'AES-256-GCM',
      salt: base64urlEncode(salt),
      iv: base64urlEncode(iv),
      ciphertext: base64urlEncode(new Uint8Array(ciphertext)),
    },
  };
}

export async function encryptSeedBackup(seedHex, did, passphrase) {
  if (typeof passphrase !== 'string' || Array.from(passphrase).length < 12) {
    throw new Error('Passphrase must contain at least 12 characters.');
  }
  if (!DID_RE.test(did) || await createDid(seedHex) !== did) throw new Error('DID does not match the identity seed.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(passphrase, salt, ['encrypt']);
  const additionalData = encoder.encode(`technocore-seed-backup|${did}`);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, hexToBytes(seedHex));
  return {
    format: 'technocore-seed-backup',
    version: 1,
    did,
    purpose: 'Passphrase-encrypted Ed25519 seed recovery backup. Secret — never share.',
    crypto: {
      kdf: 'PBKDF2-SHA256',
      iterations: PBKDF2_ITERATIONS,
      cipher: 'AES-256-GCM',
      salt: base64urlEncode(salt),
      iv: base64urlEncode(iv),
      ciphertext: base64urlEncode(new Uint8Array(ciphertext)),
    },
  };
}

export async function decryptSeedBackup(backup, passphrase) {
  try {
    if (backup?.format !== 'technocore-seed-backup' || backup?.version !== 1 || !DID_RE.test(backup.did)) throw new Error('unsupported');
    if (backup.crypto?.kdf !== 'PBKDF2-SHA256' || backup.crypto?.iterations !== PBKDF2_ITERATIONS || backup.crypto?.cipher !== 'AES-256-GCM') throw new Error('unsupported');
    const salt = base64urlDecode(backup.crypto.salt);
    const iv = base64urlDecode(backup.crypto.iv);
    const ciphertext = base64urlDecode(backup.crypto.ciphertext);
    const key = await deriveEncryptionKey(passphrase, salt, ['decrypt']);
    const additionalData = encoder.encode(`technocore-seed-backup|${backup.did}`);
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key, ciphertext);
    const seedHex = bytesToHex(new Uint8Array(clear));
    if (await createDid(seedHex) !== backup.did) throw new Error('mismatch');
    return seedHex;
  } catch (error) {
    if (error?.message === 'unsupported') throw new Error('Unsupported or malformed seed-only backup.');
    throw new Error('Incorrect passphrase or damaged seed-only backup.');
  }
}

export async function decryptIdentity(backup, passphrase) {
  try {
    if (backup?.format !== 'technocore-did-studio' || backup?.version !== 1 || !DID_RE.test(backup.did)) {
      throw new Error('unsupported');
    }
    if (backup.crypto?.kdf !== 'PBKDF2-SHA256' || backup.crypto?.iterations !== PBKDF2_ITERATIONS || backup.crypto?.cipher !== 'AES-256-GCM') {
      throw new Error('unsupported');
    }
    const salt = base64urlDecode(backup.crypto.salt);
    const iv = base64urlDecode(backup.crypto.iv);
    const ciphertext = base64urlDecode(backup.crypto.ciphertext);
    const key = await deriveEncryptionKey(passphrase, salt, ['decrypt']);
    const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(backup.did) }, key, ciphertext);
    const seedHex = bytesToHex(new Uint8Array(clear));
    if (await createDid(seedHex) !== backup.did) throw new Error('mismatch');
    return seedHex;
  } catch (error) {
    if (error?.message === 'unsupported') throw new Error('Unsupported or malformed identity backup.');
    throw new Error('Incorrect passphrase or damaged identity backup.');
  }
}

export async function decryptPortableBackup(backup, passphrase) {
  let seed;
  if (backup?.format === 'technocore-did-studio') seed = await decryptIdentity(backup, passphrase);
  else if (backup?.format === 'technocore-seed-backup') seed = await decryptSeedBackup(backup, passphrase);
  else throw new Error('Unsupported backup format. Choose an encrypted identity JSON or encrypted seed-only JSON file.');
  return { seed, did: backup.did, format: backup.format };
}

export function signedMessageUrl(baseUrl, room, did, signature, nonce, text) {
  const url = new URL(baseUrl);
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) throw new Error('Server URL must use HTTPS except on localhost.');
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Server URL must contain only an origin.');
  validateRoom(room);
  validateNonce(nonce);
  if (!DID_RE.test(did)) throw new Error('DID is not a canonical Ed25519 did:key.');
  if (!SIG_RE.test(signature)) throw new Error('Signature must be 86 base64url characters.');
  const origin = url.origin;
  return `${origin}/r/${room}/say-signed/${did}/${signature}/${nonce}/${encodeURIComponent(text)}`;
}
