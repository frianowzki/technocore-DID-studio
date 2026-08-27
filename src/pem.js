import { fromBER } from 'asn1js';

const OIDS = Object.freeze({
  pbes2: '1.2.840.113549.1.5.13',
  pbkdf2: '1.2.840.113549.1.5.12',
  hmacSha256: '1.2.840.113549.2.9',
  aes256Cbc: '2.16.840.1.101.3.4.1.42',
  ed25519: '1.3.101.112',
});
const encoder = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function pemBytes(pem) {
  if (typeof pem !== 'string') throw new Error('Choose an encrypted PKCS#8 identity.pem file.');
  const match = pem.trim().match(/^-----BEGIN ENCRYPTED PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)\s+-----END ENCRYPTED PRIVATE KEY-----$/u);
  if (!match) throw new Error('Choose an encrypted PKCS#8 identity.pem file.');
  try {
    const binary = atob(match[1].replace(/\s/gu, ''));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error('Choose an encrypted PKCS#8 identity.pem file.');
  }
}

function values(item, length) {
  const result = item?.valueBlock?.value;
  if (!Array.isArray(result) || result.length !== length) throw new Error('unsupported');
  return result;
}

function oid(item) {
  const value = item?.valueBlock?.toString?.();
  if (!value) throw new Error('unsupported');
  return value;
}

function octets(item, length) {
  const value = item?.valueBlock?.valueHexView;
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) throw new Error('unsupported');
  return value;
}

function parseEncryptedPrivateKey(bytes) {
  const decoded = fromBER(bytes);
  if (decoded.offset === -1) throw new Error('unsupported');
  const [algorithm, encrypted] = values(decoded.result, 2);
  const [algorithmOid, parameters] = values(algorithm, 2);
  if (oid(algorithmOid) !== OIDS.pbes2) throw new Error('unsupported');

  const [keyDerivation, encryption] = values(parameters, 2);
  const [keyDerivationOid, pbkdf2] = values(keyDerivation, 2);
  if (oid(keyDerivationOid) !== OIDS.pbkdf2) throw new Error('unsupported');
  const pbkdf2Values = values(pbkdf2, 3);
  const salt = octets(pbkdf2Values[0]);
  const iterations = pbkdf2Values[1]?.valueBlock?.valueDec;
  const [prfOid] = values(pbkdf2Values[2], 2);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || oid(prfOid) !== OIDS.hmacSha256) throw new Error('unsupported');

  const [encryptionOid, ivValue] = values(encryption, 2);
  if (oid(encryptionOid) !== OIDS.aes256Cbc) throw new Error('unsupported');
  return { salt, iterations, iv: octets(ivValue, 16), encrypted: octets(encrypted) };
}

function parseEd25519Seed(clearBytes) {
  const decoded = fromBER(clearBytes);
  if (decoded.offset === -1) throw new Error('unsupported');
  const [version, algorithm, privateKey] = values(decoded.result, 3);
  if (version?.valueBlock?.valueDec !== 0) throw new Error('unsupported');
  const [algorithmOid] = values(algorithm, 1);
  if (oid(algorithmOid) !== OIDS.ed25519) throw new Error('unsupported');
  const inner = fromBER(octets(privateKey));
  if (inner.offset === -1) throw new Error('unsupported');
  return octets(inner.result, 32);
}

export async function decryptIdentityPem(pem, passphrase) {
  let encrypted;
  try {
    encrypted = parseEncryptedPrivateKey(pemBytes(pem));
  } catch (error) {
    if (error?.message === 'Choose an encrypted PKCS#8 identity.pem file.') throw error;
    throw new Error('Incorrect passphrase or unsupported identity.pem.');
  }
  try {
    const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: encrypted.salt, iterations: encrypted.iterations },
      material,
      { name: 'AES-CBC', length: 256 },
      false,
      ['decrypt'],
    );
    const clear = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: encrypted.iv }, key, encrypted.encrypted);
    return bytesToHex(parseEd25519Seed(new Uint8Array(clear)));
  } catch {
    throw new Error('Incorrect passphrase or unsupported identity.pem.');
  }
}
