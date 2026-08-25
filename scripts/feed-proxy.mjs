const ORIGIN = 'https://technocore.chat';
const ROOM_ENTRY_LIMIT = 200;
const ROOMS = [
  { room: 'lobby', kind: 'introduction' },
  { room: 'technocore', kind: 'contribution' },
];

function normalizeRoom(data, expectedRoom, kind) {
  if (!data || data.room !== expectedRoom || !Array.isArray(data.messages)) {
    throw new Error(`Technocore returned a malformed response for ${expectedRoom}.`);
  }
  return data.messages.map((message) => {
    if (!Number.isInteger(message?.seq) || typeof message.ts !== 'string' || !Number.isFinite(Date.parse(message.ts)) || typeof message.from !== 'string' || typeof message.text !== 'string') {
      throw new Error(`Technocore returned a malformed response for ${expectedRoom}.`);
    }
    return {
      room: expectedRoom,
      kind,
      seq: message.seq,
      timestamp: message.ts,
      from: message.from,
      text: message.text,
      nonce: message.nonce ?? null,
    };
  });
}

async function fetchRoom({ room, kind }, fetchImpl) {
  const url = `${ORIGIN}/r/${room}?format=json&limit=${ROOM_ENTRY_LIMIT}`;
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Technocore returned HTTP ${response.status} for ${room}.`);
  let data;
  try { data = await response.json(); } catch { throw new Error(`Technocore returned a malformed response for ${room}.`); }
  return normalizeRoom(data, room, kind);
}

export async function getLiveFeed({ fetchImpl = fetch, now = () => new Date() } = {}) {
  const batches = await Promise.all(ROOMS.map((entry) => fetchRoom(entry, fetchImpl)));
  const messages = batches.flat().sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.seq - a.seq);
  return { updatedAt: now().toISOString(), messages };
}
