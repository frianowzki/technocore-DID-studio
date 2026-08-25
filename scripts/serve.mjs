import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { proxyPublish } from './publish-proxy.mjs';
import { getLiveFeed } from './feed-proxy.mjs';

const root = join(process.cwd(), 'dist');
let feedCache = null;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.md': 'text/markdown; charset=utf-8' };
const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self' https://technocore.chat; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function json(response, status, data) {
  response.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error('Request body exceeds 16 KiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('Request body must be valid JSON.'); }
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/api/publish') {
    if (request.method !== 'POST') return json(response, 405, { error: 'Method not allowed.' });
    try {
      const result = await proxyPublish(await readJson(request));
      return json(response, 200, result);
    } catch (error) {
      const status = /Technocore returned HTTP/u.test(error.message) ? 502 : 400;
      return json(response, status, { error: error.message });
    }
  }
  if (pathname === '/api/feed') {
    if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed.' });
    if (feedCache && Date.now() - feedCache.fetchedAt < 8000) return json(response, 200, feedCache.data);
    try {
      const data = await getLiveFeed();
      feedCache = { fetchedAt: Date.now(), data };
      return json(response, 200, data);
    } catch (error) {
      if (feedCache) return json(response, 200, { ...feedCache.data, stale: true });
      return json(response, 502, { error: error.message });
    }
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed.' });
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = normalize(join(root, relative));
  if (!file.startsWith(root)) { response.writeHead(403, securityHeaders).end('Forbidden'); return; }
  try {
    if (!statSync(file).isFile()) throw new Error('not file');
    response.writeHead(200, { ...securityHeaders, 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    if (request.method === 'HEAD') return response.end();
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});
server.listen(4173, '127.0.0.1', () => console.log('Technocore DID Studio: http://localhost:4173'));
