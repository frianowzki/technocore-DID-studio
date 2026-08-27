const STORAGE_PREFIX = 'technocore-public-history:';
const MAX_HISTORY_RECORDS = 1000;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const DEFAULT_ORIGIN = 'https://technocore.chat';

// Trust ranking for the same room+seq record seen through different lenses.
// Publish-confirmed is strongest; a live feed sighting only corroborates.
const SOURCE_RANK = { verified: 3, imported: 2, network: 1, saved: 0 };

export const HISTORY_BACKUP_FORMAT = 'technocore-public-history';
export const HISTORY_BACKUP_VERSION = 1;

function kindForRoom(room) {
  if (room === 'lobby') return 'introduction';
  if (room === 'technocore') return 'contribution';
  return 'message';
}

function recordDid(record) {
  return record?.did ?? record?.from;
}

// Normalize any origin-ish value to a bare https(s) origin, or the default.
function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value) return DEFAULT_ORIGIN;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return DEFAULT_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function normalizeRecord(record, expectedDid, source = 'saved') {
  const did = recordDid(record);
  if (did !== expectedDid) throw new Error('History entry belongs to a different DID.');
  const room = record?.room;
  const seq = record?.seq ?? record?.sequence;
  const timestamp = record?.timestamp ?? record?.ts;
  if (typeof room !== 'string' || !NAME_RE.test(room) || !Number.isInteger(seq) || seq <= 0 || typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp)) || typeof record?.text !== 'string') {
    throw new Error('History entry is malformed.');
  }
  const nonce = record.nonce === null || record.nonce === undefined ? null : String(record.nonce);
  if (nonce !== null && !/^[0-9]{1,19}$/u.test(nonce)) throw new Error('History entry is malformed.');
  const seenAt = typeof record.seenAt === 'string' && Number.isFinite(Date.parse(record.seenAt)) ? record.seenAt : null;
  return {
    room,
    kind: kindForRoom(room),
    seq,
    timestamp,
    did,
    nonce,
    text: record.text,
    origin: normalizeOrigin(record.origin ?? record.baseUrl ?? record.server),
    source,
    seenAt,
  };
}

// Keep the higher-trust source, but carry forward the most recent live-feed
// sighting timestamp so provenance can say "seen in feed on <date>".
function combine(previous, next, nowIso) {
  const seenCandidates = [previous?.seenAt, next?.seenAt];
  if (previous?.source === 'network') seenCandidates.push(previous.timestamp);
  if (next?.source === 'network') seenCandidates.push(nowIso);
  const seenValues = seenCandidates.filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  const seenAt = seenValues.length ? seenValues.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
  if (!previous) return { ...next, seenAt };
  const winner = SOURCE_RANK[next.source] >= SOURCE_RANK[previous.source] ? next : previous;
  return { ...winner, seenAt };
}

export function historyForDid(records, did) {
  if (!did?.startsWith('did:key:') || !Array.isArray(records)) return [];
  return records.filter((record) => recordDid(record) === did).map((record) => normalizeRecord(record, did, record.source));
}

export function mergeDidHistory({ did, existing = [], feed = [], publications = [], imported = [], now = () => new Date().toISOString() } = {}) {
  if (!did?.startsWith('did:key:')) return [];
  const nowIso = typeof now === 'function' ? now() : String(now);
  const merged = new Map();
  const add = (record, source, strict = false) => {
    if (!record || (!strict && recordDid(record) !== did)) return;
    const normalized = normalizeRecord(record, did, source);
    const key = `${normalized.origin}:${normalized.room}:${normalized.seq}`;
    merged.set(key, combine(merged.get(key), normalized, nowIso));
  };
  existing.forEach((record) => add(record, record.source || 'saved'));
  feed.forEach((record) => add(record, 'network'));
  publications.filter(Boolean).forEach((record) => add(record, 'verified'));
  imported.forEach((record) => add(record, 'imported', true));
  return [...merged.values()]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.seq - a.seq)
    .slice(0, MAX_HISTORY_RECORDS);
}

// Human-readable provenance for one history record. Never claims global or
// all-time verification — only what this browser can actually attest.
export function provenanceLabel(record) {
  switch (record?.source) {
    case 'verified': return 'Publish-confirmed';
    case 'imported': return 'Imported evidence';
    case 'network': return 'In retained feed now';
    default:
      return record?.seenAt ? 'Saved evidence · last seen in feed' : 'Saved evidence';
  }
}

export function readDidHistory(did, storage = globalThis.localStorage) {
  if (!storage || !did?.startsWith('did:key:')) return [];
  try {
    const parsed = JSON.parse(storage.getItem(`${STORAGE_PREFIX}${did}`) || '[]');
    return historyForDid(parsed, did);
  } catch {
    return [];
  }
}

export function writeDidHistory(did, records, storage = globalThis.localStorage) {
  if (!storage || !did?.startsWith('did:key:')) return [];
  const safe = mergeDidHistory({ did, existing: records });
  storage.setItem(`${STORAGE_PREFIX}${did}`, JSON.stringify(safe));
  return safe;
}

export function clearDidHistory(did, storage = globalThis.localStorage) {
  if (!storage || !did?.startsWith('did:key:')) return false;
  storage.removeItem(`${STORAGE_PREFIX}${did}`);
  return true;
}

// Build a portable, public-only backup of a DID's merged history. Contains
// nothing private — no seed, passphrase, PEM, or signature material.
export function createHistoryBackup(did, records, { exportedAt = new Date().toISOString() } = {}) {
  const safe = historyForDid(Array.isArray(records) ? records : [], did);
  return {
    format: HISTORY_BACKUP_FORMAT,
    version: HISTORY_BACKUP_VERSION,
    exportedAt,
    did: did || null,
    records: safe.map((record) => ({
      room: record.room,
      seq: record.seq,
      timestamp: record.timestamp,
      did: record.did,
      nonce: record.nonce,
      text: record.text,
      origin: record.origin,
      source: record.source === 'network' ? 'saved' : record.source,
      seenAt: record.seenAt,
    })),
    security: 'Public evidence only. No private seed, encrypted identity backup, identity.pem, or passphrase.',
  };
}

// Accept both the new history-backup format and the older evidence backup so a
// single importer covers every public artifact this studio has produced.
export function recordsFromHistoryBackup(backup, did) {
  if (backup?.format === HISTORY_BACKUP_FORMAT && backup?.version === HISTORY_BACKUP_VERSION) {
    if (backup.did !== did) throw new Error('Choose a history backup for the active DID.');
    return (Array.isArray(backup.records) ? backup.records : []).map((record) => ({ ...record, did }));
  }
  return publicationsFromEvidence(backup, did);
}

export function publicationsFromEvidence(evidence, did) {
  if (evidence?.format !== 'technocore-public-evidence' || evidence?.version !== 1 || evidence.did !== did) {
    throw new Error('Choose a public evidence backup for the active DID.');
  }
  return Object.values(evidence.publications || {}).filter(Boolean).map((record) => ({
    room: record.room,
    sequence: record.sequence,
    timestamp: record.timestamp,
    did: record.did,
    nonce: record.nonce,
    text: record.text,
    origin: record.origin,
  }));
}
