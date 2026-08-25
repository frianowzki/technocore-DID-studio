import test from 'node:test';
import assert from 'node:assert/strict';
import { filterFeed, relativeTime, shortAuthor } from '../src/feed.js';

const messages = [
  { kind: 'introduction', seq: 1 },
  { kind: 'contribution', seq: 2 },
];

test('filters feed by introductions or contributions', () => {
  assert.deepEqual(filterFeed(messages, 'all').map((item) => item.seq), [1, 2]);
  assert.deepEqual(filterFeed(messages, 'introduction').map((item) => item.seq), [1]);
  assert.deepEqual(filterFeed(messages, 'contribution').map((item) => item.seq), [2]);
});

test('formats authors and relative timestamps compactly', () => {
  assert.equal(shortAuthor('did:key:z6MkjEANfnTYcXrMM4PLSmdi7sFvES5wiFxjevKpVEC4oeUp'), 'z6MkjEAN…EC4oeUp');
  assert.equal(shortAuthor('alice'), '~alice');
  assert.equal(relativeTime('2026-08-25T09:00:00Z', new Date('2026-08-25T09:02:00Z')), '2m ago');
});
