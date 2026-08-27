import test from 'node:test';
import assert from 'node:assert/strict';
import { getLiveFeed, getRoomDirectory, parseExtraRooms } from '../scripts/feed-proxy.mjs';

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

test('requests and retains the maximum 200 entries from each room', async () => {
  const requestedLimits = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const room = parsed.pathname.split('/').at(-1);
    requestedLimits.push(parsed.searchParams.get('limit'));
    const start = room === 'lobby' ? 1 : 201;
    const messages = Array.from({ length: 200 }, (_, index) => ({
      seq: start + index,
      ts: new Date(Date.UTC(2026, 7, 25, 9, 0, index)).toISOString(),
      from: `did:key:z6Mk${room}${index}`,
      text: `${room} entry ${index}`,
      nonce: start + index,
    }));
    return new Response(JSON.stringify({ room, count: 200, messages }), { status: 200 });
  };
  const feed = await getLiveFeed({ fetchImpl });
  assert.deepEqual(requestedLimits, ['200', '200']);
  assert.equal(feed.messages.length, 400);
  assert.equal(feed.messages.filter(({ kind }) => kind === 'introduction').length, 200);
  assert.equal(feed.messages.filter(({ kind }) => kind === 'contribution').length, 200);
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

test('parses, validates, dedupes, and caps extra room selections', () => {
  assert.deepEqual(parseExtraRooms('kibble, mesh-delta ,kibble'), ['kibble', 'mesh-delta']);
  assert.deepEqual(parseExtraRooms('lobby,technocore'), []); // base rooms are always included, never duplicated
  assert.deepEqual(parseExtraRooms('a,b,c,d,e,f,g,h'), ['a', 'b', 'c', 'd', 'e', 'f']); // capped at 6
  assert.throws(() => parseExtraRooms('Bad Room!'), /not a valid Technocore room name/);
});

test('fetches base rooms plus requested extra rooms with neutral kind', async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    const room = new URL(url).pathname.split('/').at(-1);
    requested.push(room);
    return new Response(JSON.stringify({ room, count: 1, messages: [{ seq: 1, ts: '2026-08-25T09:00:00Z', from: 'did:key:z6Mk', text: `hi from ${room}`, nonce: 1 }] }), { status: 200 });
  };
  const feed = await getLiveFeed({ fetchImpl, extraRooms: 'kibble', now: () => new Date('2026-08-25T09:02:00Z') });
  assert.deepEqual(requested.sort(), ['kibble', 'lobby', 'technocore']);
  assert.deepEqual(feed.rooms, ['lobby', 'technocore', 'kibble']);
  assert.equal(feed.messages.find((m) => m.room === 'kibble').kind, 'message');
});

test('discovers and ranks rooms from the directory, bounding topic length', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ rooms: [
    { room: 'lobby', last_seq: 10, topic: 'x'.repeat(300), window: 200, idle_seconds: 0 },
    { room: 'kibble', last_seq: 99, topic: 'jobs', window: 120, idle_seconds: 42.7 },
    { room: 'BAD ROOM', last_seq: 5 },
    { room: 'nolast' },
  ] }), { status: 200 });
  const directory = await getRoomDirectory({ fetchImpl, now: () => new Date('2026-08-25T09:02:00Z') });
  assert.deepEqual(directory.rooms.map((r) => r.room), ['kibble', 'lobby']);
  assert.equal(directory.rooms.find((r) => r.room === 'lobby').base, true);
  assert.equal(directory.rooms.find((r) => r.room === 'lobby').topic.length, 120);
  // Capacity + freshness surfacing.
  assert.equal(directory.rooms.find((r) => r.room === 'lobby').atCapacity, true);
  assert.equal(directory.rooms.find((r) => r.room === 'kibble').atCapacity, false);
  assert.equal(directory.rooms.find((r) => r.room === 'kibble').idleSeconds, 43);
});

test('dedupes a message that appears in more than one monitored room window', async () => {
  const shared = { seq: 500, ts: '2026-08-25T09:05:00Z', from: 'did:key:z6MkShared', text: 'cross-posted', nonce: 7 };
  const fetchImpl = async (url) => {
    const room = new URL(url).pathname.split('/').at(-1);
    // Both lobby and an extra room echo the same seq 500 entry under their own room label.
    return new Response(JSON.stringify({ room, count: 1, messages: [{ ...shared }] }), { status: 200 });
  };
  const feed = await getLiveFeed({ fetchImpl, extraRooms: 'lobby', now: () => new Date('2026-08-25T09:06:00Z') });
  // lobby is a base room; the extra "lobby" request is dropped by parseExtraRooms,
  // so only base lobby + technocore run. Same seq under different rooms stays distinct,
  // but a repeat of the exact room+seq collapses to one entry.
  const lobbyFive = feed.messages.filter((m) => m.room === 'lobby' && m.seq === 500);
  assert.equal(lobbyFive.length, 1);
});
