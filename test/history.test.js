import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearDidHistory,
  createHistoryBackup,
  historyForDid,
  mergeDidHistory,
  provenanceLabel,
  publicationsFromEvidence,
  readDidHistory,
  recordsFromHistoryBackup,
  writeDidHistory,
} from '../src/history.js';

const DID = 'did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd';
const OTHER_DID = 'did:key:z6Mkoooooooooooooooooooooooooooooooooooooooooooo';
const lobby = { room: 'lobby', kind: 'introduction', seq: 42, timestamp: '2026-08-25T08:00:00Z', from: DID, text: 'hello', nonce: '100' };
const contribution = { room: 'technocore', kind: 'contribution', seq: 84, timestamp: '2026-08-25T09:00:00Z', did: DID, text: 'work', nonce: '101' };

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}

test('merges exact-DID feed matches and verified publications without duplicates', () => {
  const history = mergeDidHistory({
    did: DID,
    existing: [lobby],
    feed: [lobby, { ...lobby, seq: 43, from: OTHER_DID }],
    publications: [contribution, { ...contribution, seq: 84 }],
  });
  assert.deepEqual(history.map(({ room, seq }) => [room, seq]), [['technocore', 84], ['lobby', 42]]);
  assert.equal(history.every((item) => item.did === DID), true);
});

test('persists only bounded public evidence keyed by DID', () => {
  const storage = memoryStorage();
  writeDidHistory(DID, [lobby, contribution], storage);
  const stored = readDidHistory(DID, storage);
  assert.equal(stored.length, 2);
  assert.equal(JSON.stringify(stored).includes('seed'), false);
  assert.equal(JSON.stringify(stored).includes('passphrase'), false);
  assert.deepEqual(historyForDid(stored, DID).map((item) => item.seq).sort((a, b) => a - b), [42, 84]);
});

test('rejects imported evidence for a different DID', () => {
  assert.throws(() => mergeDidHistory({ did: DID, imported: [{ ...lobby, did: OTHER_DID, from: undefined }] }), /different DID/i);
});

test('extracts public publications only from same-DID evidence backups', () => {
  const evidence = {
    format: 'technocore-public-evidence',
    version: 1,
    did: DID,
    publications: {
      lobby: { room: 'lobby', sequence: 42, timestamp: lobby.timestamp, did: DID, nonce: lobby.nonce, text: lobby.text },
      technocore: null,
    },
    privateSeed: 'must be ignored',
  };
  const extracted = publicationsFromEvidence(evidence, DID);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].room, 'lobby');
  assert.equal(extracted[0].sequence, 42);
  assert.throws(() => publicationsFromEvidence({ ...evidence, did: OTHER_DID }, DID), /active DID/i);
});

test('ranks provenance so publish-confirmed beats a live-feed sighting', () => {
  const history = mergeDidHistory({
    did: DID,
    feed: [{ ...lobby }],
    publications: [{ ...lobby, did: DID, from: undefined }],
    now: () => '2026-08-26T00:00:00Z',
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].source, 'verified');
  assert.equal(provenanceLabel(history[0]), 'Publish-confirmed');
});

test('carries forward a prior live-feed sighting when the record is no longer in the feed', () => {
  // A record previously saved with a recorded sighting, not present in the current feed.
  const history = mergeDidHistory({
    did: DID,
    existing: [{ ...lobby, source: 'saved', seenAt: '2026-08-26T10:00:00Z' }],
    now: () => '2026-08-27T00:00:00Z',
  });
  assert.equal(history[0].seenAt, '2026-08-26T10:00:00Z');
  assert.equal(provenanceLabel(history[0]), 'Saved evidence · last seen in feed');
});

test('keeps records from different origins distinct', () => {
  const history = mergeDidHistory({
    did: DID,
    existing: [
      { ...lobby, origin: 'https://technocore.chat' },
      { ...lobby, origin: 'https://example.test' },
    ],
  });
  assert.equal(history.length, 2);
});

test('round-trips a public history backup for the same DID', () => {
  const merged = mergeDidHistory({ did: DID, publications: [{ ...lobby, did: DID, from: undefined }, contribution] });
  const backup = createHistoryBackup(DID, merged);
  assert.equal(backup.format, 'technocore-public-history');
  // The record payload must carry no private material (the human-readable
  // security note deliberately mentions the words seed/passphrase).
  assert.equal(JSON.stringify(backup.records).includes('seed'), false);
  assert.equal(JSON.stringify(backup.records).includes('passphrase'), false);
  const restored = recordsFromHistoryBackup(backup, DID);
  assert.equal(restored.length, 2);
  assert.throws(() => recordsFromHistoryBackup(backup, OTHER_DID), /active DID/i);
});

test('history importer also accepts the older evidence format', () => {
  const evidence = {
    format: 'technocore-public-evidence',
    version: 1,
    did: DID,
    publications: { lobby: { room: 'lobby', sequence: 42, timestamp: lobby.timestamp, did: DID, nonce: lobby.nonce, text: lobby.text } },
  };
  const records = recordsFromHistoryBackup(evidence, DID);
  assert.equal(records.length, 1);
  assert.equal(records[0].sequence, 42);
});

test('clears only the targeted DID history', () => {
  const storage = memoryStorage();
  writeDidHistory(DID, [lobby], storage);
  writeDidHistory(OTHER_DID, [{ ...lobby, from: OTHER_DID }], storage);
  clearDidHistory(DID, storage);
  assert.equal(readDidHistory(DID, storage).length, 0);
  assert.equal(readDidHistory(OTHER_DID, storage).length, 1);
});
