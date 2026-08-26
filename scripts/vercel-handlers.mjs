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
  let feedCache = null;
  return async function feedHandler(request, response) {
    if (request.method !== 'GET') return sendJson(response, 405, { error: 'Method not allowed.' });
    if (feedCache && now() - feedCache.fetchedAt < 8000) return sendJson(response, 200, feedCache.data);
    try {
      const data = await getFeed();
      feedCache = { fetchedAt: now(), data };
      return sendJson(response, 200, data);
    } catch (error) {
      if (feedCache) return sendJson(response, 200, { ...feedCache.data, stale: true });
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
