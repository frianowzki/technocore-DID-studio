import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContributionMessage, createEvidenceBackup, validateContribution } from '../src/contribution.js';

const did = 'did:key:z6MkExample';
const input = {
  format: 'code',
  url: 'https://example.com/tool',
};
const lobby = { room: 'lobby', seq: 42, timestamp: '2026-08-25T08:00:00Z', did, nonce: '100', text: 'hello' };
const technocore = { room: 'technocore', seq: 84, timestamp: '2026-08-25T09:00:00Z', did, nonce: '101', text: 'contribution' };

test('validates a useful public contribution and builds its record message', () => {
  const contribution = validateContribution(input, did);
  assert.equal(contribution.formatLabel, 'Code or tool');
  assert.equal(contribution.url, 'https://example.com/tool');
  assert.equal(
    buildContributionMessage(contribution, did),
    'Public contribution [code]: Code or tool by did:key:z6MkExample. Mentions @flop_labs. Public URL: https://example.com/tool',
  );
});

test('requires a public HTTPS URL without a checklist', () => {
  const contribution = validateContribution(input, did);
  assert.equal(Object.hasOwn(contribution, 'checks'), false);
  assert.throws(() => validateContribution({ ...input, url: 'http://example.com' }, did), /HTTPS/u);
});

test('evidence backup preserves room coordinates and excludes secrets', () => {
  const contribution = validateContribution(input, did);
  const backup = createEvidenceBackup({
    did,
    contribution,
    records: { lobby, technocore },
    exportedAt: '2026-08-25T10:00:00.000Z',
    seed: 'NEVER_INCLUDE',
    passphrase: 'NEVER_INCLUDE',
  });
  assert.equal(backup.publications.lobby.sequence, 42);
  assert.equal(backup.publications.technocore.room, 'technocore');
  assert.equal(backup.contribution.format, 'code');
  assert.equal(JSON.stringify(backup).includes('NEVER_INCLUDE'), false);
});
