const STORAGE_PREFIX = 'technocore-public-history:';
const MAX_HISTORY_RECORDS = 1000;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;

function kindForRoom(room) {
  if (room === 'lobby') return 'introduction';
  if (room === 'technocore') return 'contribution';
  return 'message';
}

function recordDid(record) {
  return record?.did ?? record?.from;
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
  return {
    room,
    kind: kindForRoom(room),
    seq,
    timestamp,
    did,
    nonce,
    text: record.text,
    source,
  };
}

export function historyForDid(records, did) {
  if (!did?.startsWith('did:key:') || !Array.isArray(records)) return [];
  return records.filter((record) => recordDid(record) === did).map((record) => normalizeRecord(record, did, record.source));
}

export function mergeDidHistory({ did, existing = [], feed = [], publications = [], imported = [] } = {}) {
  if (!did?.startsWith('did:key:')) return [];
  const merged = new Map();
  const add = (record, source, strict = false) => {
    if (!record || (!strict && recordDid(record) !== did)) return;
    const normalized = normalizeRecord(record, did, source);
    merged.set(`${normalized.room}:${normalized.seq}`, normalized);
  };
  existing.forEach((record) => add(record, record.source || 'saved'));
  feed.forEach((record) => add(record, 'network'));
  publications.filter(Boolean).forEach((record) => add(record, 'verified'));
  imported.forEach((record) => add(record, 'imported', true));
  return [...merged.values()]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.seq - a.seq)
    .slice(0, MAX_HISTORY_RECORDS);
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
  }));
}
