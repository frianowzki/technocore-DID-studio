const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function sendJson(response, status, data) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  return response.status(status).json(data);
}

function parseBody(body) {
  const serialized = typeof body === 'string' ? body : JSON.stringify(body);
  if (!serialized) throw new Error('Request body must be valid JSON.');
  if (Buffer.byteLength(serialized, 'utf8') > 16 * 1024) throw new Error('Request body exceeds 16 KiB.');
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { throw new Error('Request body must be valid JSON.'); }
  }
  return body;
}

export function createFeedHandler({ getFeed, now = Date.now } = {}) {
  const feedCache = new Map();
  return async function feedHandler(request, response) {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed.' });
    let extraRooms = '';
    try {
      const requested = new URL(request.url, 'http://localhost').searchParams.get('rooms') ?? '';
      extraRooms = requested;
    } catch { extraRooms = ''; }
    const cacheKey = extraRooms.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean).sort().join(',');
    const cached = feedCache.get(cacheKey);
    if (cached && now() - cached.fetchedAt < 8000) return sendJson(response, 200, cached.data);
    try {
      const data = await getFeed({ extraRooms });
      feedCache.set(cacheKey, { fetchedAt: now(), data });
      return sendJson(response, 200, data);
    } catch (error) {
      if (cached) return sendJson(response, 200, { ...cached.data, stale: true });
      return sendJson(response, 502, { error: error.message });
    }
  };
}

export function createRoomsHandler({ getRooms, now = Date.now } = {}) {
  let roomsCache = null;
  return async function roomsHandler(request, response) {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed.' });
    if (roomsCache && now() - roomsCache.fetchedAt < 30000) return sendJson(response, 200, roomsCache.data);
    try {
      const data = await getRooms();
      roomsCache = { fetchedAt: now(), data };
      return sendJson(response, 200, data);
    } catch (error) {
      if (roomsCache) return sendJson(response, 200, { ...roomsCache.data, stale: true });
      return sendJson(response, 502, { error: error.message });
    }
  };
}

export function createPublishHandler({ publish } = {}) {
  return async function publishHandler(request, response) {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed.' });
    try {
      return sendJson(response, 200, await publish(parseBody(request.body)));
    } catch (error) {
      const status = /Technocore returned HTTP/u.test(error.message) ? 502 : 400;
      return sendJson(response, status, { error: error.message });
    }
  };
}
