import test from 'node:test';
import assert from 'node:assert/strict';
import {
  historyForDid,
  mergeDidHistory,
  publicationsFromEvidence,
  readDidHistory,
  writeDidHistory,
} from '../src/history.js';

const DID = 'did:key:z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd';
const OTHER_DID = 'did:key:z6Mkoooooooooooooooooooooooooooooooooooooooooooo';
const lobby = { room: 'lobby', kind: 'introduction', seq: 42, timestamp: '2026-08-25T08:00:00Z', from: DID, text: 'hello', nonce: '100' };
const contribution = { room: 'technocore', kind: 'contribution', seq: 84, timestamp: '2026-08-25T09:00:00Z', did: DID, text: 'work', nonce: '101' };

function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
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
  assert.deepEqual(publicationsFromEvidence(evidence, DID), [{
    room: 'lobby', sequence: 42, timestamp: lobby.timestamp, did: DID, nonce: lobby.nonce, text: lobby.text,
  }]);
  assert.throws(() => publicationsFromEvidence({ ...evidence, did: OTHER_DID }, DID), /active DID/i);
});
