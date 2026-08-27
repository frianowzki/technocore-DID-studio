// Remembers the highest nonce this browser has used for each DID + room, so a
// fresh nonce is always strictly greater — Technocore rejects a nonce that is
// not greater than the last one a key used in that room. The clock alone fails
// when two publishes land in the same millisecond or when returning to a DID.
const STORAGE_PREFIX = 'technocore-nonce:';
const NONCE_RE = /^[0-9]{1,19}$/u;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/u;

function keyFor(did, room) {
  return `${STORAGE_PREFIX}${did}`;
}

function readMap(did, storage) {
  if (!storage || !did?.startsWith('did:key:')) return {};
  try {
    const parsed = JSON.parse(storage.getItem(keyFor(did)) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isNonce(value) {
  return typeof value === 'string' && NONCE_RE.test(value);
}

// Largest of: stored highest+1, and the current clock — always a valid 1–19 digit nonce.
export function nextNonceFor(did, room, { storage = globalThis.localStorage, now = Date.now } = {}) {
  const clock = String(now());
  const clockValue = isNonce(clock) ? BigInt(clock) : 0n;
  const map = readMap(did, storage);
  const stored = NAME_RE.test(room) && isNonce(map[room]) ? BigInt(map[room]) : 0n;
  const candidate = clockValue > stored ? clockValue : stored + 1n;
  const text = candidate.toString();
  // 19-digit ceiling guard; the year-5138 clock still fits, so this is defensive only.
  return text.length > 19 ? '9'.repeat(19) : text;
}

// Record that `nonce` was used for did+room, keeping only the maximum.
export function rememberNonce(did, room, nonce, storage = globalThis.localStorage) {
  if (!storage || !did?.startsWith('did:key:') || !NAME_RE.test(room) || !isNonce(String(nonce))) return;
  const map = readMap(did, storage);
  const previous = isNonce(map[room]) ? BigInt(map[room]) : 0n;
  const incoming = BigInt(String(nonce));
  if (incoming > previous) {
    map[room] = incoming.toString();
    storage.setItem(keyFor(did), JSON.stringify(map));
  }
}

export function highestNonce(did, room, storage = globalThis.localStorage) {
  const map = readMap(did, storage);
  return isNonce(map[room]) ? map[room] : null;
}
