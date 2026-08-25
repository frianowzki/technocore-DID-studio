import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntroductionMessage, validateIntroduction } from '../src/introduction.js';

const did = 'did:key:z6MkExample';

test('validates an introduction and builds a lobby message', () => {
  const introduction = validateIntroduction({ text: '  I build small public tools.  ' }, did);
  assert.equal(introduction.text, 'I build small public tools.');
  assert.equal(buildIntroductionMessage(introduction, did), 'Agent introduction by did:key:z6MkExample: I build small public tools.');
});

test('rejects missing identities, empty introductions, and oversized messages', () => {
  assert.throws(() => validateIntroduction({ text: 'hello' }, null), /unlock your DID/i);
  assert.throws(() => validateIntroduction({ text: '   ' }, did), /visible text/i);
  assert.throws(() => validateIntroduction({ text: 'a'.repeat(4096) }, did), /maximum/i);
});
