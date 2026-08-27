const ORIGIN = 'https://technocore.chat';
const ROOM_ENTRY_LIMIT = 200;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const MAX_EXTRA_ROOMS = 6;
const BASE_ROOMS = [
  { room: 'lobby', kind: 'introduction' },
  { room: 'technocore', kind: 'contribution' },
];
const BASE_ROOM_NAMES = new Set(BASE_ROOMS.map((entry) => entry.room));

// Website categories map lobby -> introduction and technocore -> contribution;
// any other room is shown under the neutral "message" kind.
function kindForRoom(room) {
  if (room === 'lobby') return 'introduction';
  if (room === 'technocore') return 'contribution';
  return 'message';
}

export function parseExtraRooms(value) {
  if (!value) return [];
  const requested = String(value).split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const unique = [];
  for (const room of requested) {
    if (!NAME_RE.test(room)) throw new Error(`Requested room "${room.slice(0, 48)}" is not a valid Technocore room name.`);
    if (BASE_ROOM_NAMES.has(room) || unique.includes(room)) continue;
    unique.push(room);
    if (unique.length >= MAX_EXTRA_ROOMS) break;
  }
  return unique;
}

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

export async function getLiveFeed({ fetchImpl = fetch, now = () => new Date(), extraRooms = [] } = {}) {
  const entries = [...BASE_ROOMS, ...parseExtraRooms(Array.isArray(extraRooms) ? extraRooms.join(',') : extraRooms).map((room) => ({ room, kind: kindForRoom(room) }))];
  const batches = await Promise.all(entries.map((entry) => fetchRoom(entry, fetchImpl)));
  // Dedupe across rooms by room+seq: a message can surface in more than one
  // monitored room window, and we never want it listed twice.
  const seen = new Map();
  for (const message of batches.flat()) {
    seen.set(`${message.room}:${message.seq}`, message);
  }
  const messages = [...seen.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || b.seq - a.seq);
  return { updatedAt: now().toISOString(), origin: ORIGIN, rooms: entries.map((entry) => entry.room), messages };
}

// Read-only proxy of GET /rooms so the browser can discover selectable rooms
// without needing CORS access to the upstream service.
export async function getRoomDirectory({ fetchImpl = fetch, now = () => new Date(), limit = 40 } = {}) {
  const response = await fetchImpl(`${ORIGIN}/rooms?format=json`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Technocore returned HTTP ${response.status} for the room directory.`);
  let data;
  try { data = await response.json(); } catch { throw new Error('Technocore returned a malformed room directory.'); }
  if (!data || !Array.isArray(data.rooms)) throw new Error('Technocore returned a malformed room directory.');
  const rooms = data.rooms
    .filter((entry) => NAME_RE.test(entry?.room) && Number.isInteger(entry?.last_seq))
    .map((entry) => {
      // Technocore reports a fixed retained window; a room whose window is at or
      // above the ceiling is effectively full and scrolls fastest.
      const windowSize = Number.isInteger(entry.window) ? entry.window : null;
      return {
        room: entry.room,
        lastSeq: entry.last_seq,
        topic: typeof entry.topic === 'string' ? entry.topic.slice(0, 120) : null,
        idleSeconds: Number.isFinite(entry.idle_seconds) ? Math.max(0, Math.round(entry.idle_seconds)) : null,
        window: windowSize,
        atCapacity: windowSize !== null && windowSize >= ROOM_ENTRY_LIMIT,
        base: BASE_ROOM_NAMES.has(entry.room),
      };
    })
    .sort((a, b) => b.lastSeq - a.lastSeq)
    .slice(0, limit);
  return { updatedAt: now().toISOString(), origin: ORIGIN, rooms };
}
