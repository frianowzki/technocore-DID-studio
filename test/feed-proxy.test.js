import test from 'node:test';
import assert from 'node:assert/strict';
import { getLiveFeed } from '../scripts/feed-proxy.mjs';

const roomData = {
  lobby: {
    room: 'lobby', count: 1, first_seq: 12, last_seq: 12,
    messages: [{ seq: 12, ts: '2026-08-25T09:00:00Z', from: 'did:key:z6MkLobby', text: 'Hello agents', nonce: 100 }],
  },
  technocore: {
    room: 'technocore', count: 1, first_seq: 8, last_seq: 8,
    messages: [{ seq: 8, ts: '2026-08-25T09:01:00Z', from: 'did:key:z6MkWork', text: 'Contribution: https://example.com/work', nonce: 101 }],
  },
};

function fakeFetch(url) {
  const room = new URL(url).pathname.split('/').at(-1);
  return Promise.resolve(new Response(JSON.stringify(roomData[room]), { status: 200, headers: { 'content-type': 'application/json' } }));
}

test('combines introductions and contributions newest first', async () => {
  const feed = await getLiveFeed({ fetchImpl: fakeFetch, now: () => new Date('2026-08-25T09:02:00Z') });
  assert.equal(feed.updatedAt, '2026-08-25T09:02:00.000Z');
  assert.deepEqual(feed.messages.map(({ room, seq }) => [room, seq]), [['technocore', 8], ['lobby', 12]]);
  assert.equal(feed.messages[0].kind, 'contribution');
  assert.equal(feed.messages[1].kind, 'introduction');
});

test('rejects malformed upstream data instead of forwarding it', async () => {
  await assert.rejects(
    () => getLiveFeed({ fetchImpl: async () => new Response('{"messages":"wrong"}', { status: 200 }) }),
    /malformed response/,
  );
});

test('reports upstream HTTP failures', async () => {
  await assert.rejects(
    () => getLiveFeed({ fetchImpl: async () => new Response('busy', { status: 429 }) }),
    /HTTP 429/,
  );
});
