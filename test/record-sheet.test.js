import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRecordSheet, recordProgress } from '../src/record-sheet.js';

const lobby = { room: 'lobby', seq: 42, timestamp: '2026-08-25T08:00:00Z', did: 'did:key:z6MkExample', nonce: '1720000000000', text: 'hello' };
const technocore = { ...lobby, room: 'technocore', seq: 84, text: 'Contribution: https://example.com/work' };
const contribution = { format: 'code', formatLabel: 'Code or tool', url: 'https://example.com/work' };

test('record progress counts the four public milestones', () => {
  assert.deepEqual(recordProgress({}), { completed: 0, total: 4 });
  assert.deepEqual(recordProgress({ did: 'did:key:z6MkExample', lobbyRecord: lobby, contribution, technocoreRecord: technocore }), { completed: 4, total: 4 });
});

test('record sheet contains public evidence but never secret fields', () => {
  const sheet = formatRecordSheet({
    did: 'did:key:z6MkExample', lobbyRecord: lobby, contribution, technocoreRecord: technocore,
    seed: 'NEVER_INCLUDE', passphrase: 'NEVER_INCLUDE',
  });
  assert.match(sheet, /Your DID: did:key:z6MkExample/u);
  assert.match(sheet, /Lobby record: lobby #42/u);
  assert.match(sheet, /Contribution format: Code or tool/u);
  assert.match(sheet, /Contribution URL: https:\/\/example.com\/work/u);
  assert.match(sheet, /Technocore record: technocore #84/u);
  assert.equal(sheet.includes('NEVER_INCLUDE'), false);
  assert.match(sheet, /contains public evidence only/i);
});
