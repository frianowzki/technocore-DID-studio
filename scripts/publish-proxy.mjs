const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const NONCE_RE = /^[0-9]{1,19}$/;
const DID_RE = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const SIG_RE = /^[A-Za-z0-9_-]{86}$/;
const FIELDS = ['baseUrl', 'room', 'did', 'signature', 'nonce', 'text'];
const DEFAULT_ORIGINS = ['https://technocore.chat', 'http://localhost:8080', 'http://127.0.0.1:8080'];
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function allowedOrigins() {
  const configured = process.env.TECHNOCORE_ALLOWED_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean);
  return new Set(configured?.length ? configured : DEFAULT_ORIGINS);
}

export function validatePublishPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Publish payload must be a JSON object.');
  const keys = Object.keys(value).sort();
  const expected = [...FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw new Error('Publish payload contains a missing or unexpected field.');
  let origin;
  try {
    const parsed = new URL(value.baseUrl);
    if (parsed.origin !== value.baseUrl || parsed.pathname !== '/') throw new Error('origin only');
    origin = parsed.origin;
  } catch {
    throw new Error('Server base URL must be an exact origin.');
  }
  if (!allowedOrigins().has(origin)) throw new Error(`Server origin ${origin} is not allowed by this local proxy.`);
  if (!NAME_RE.test(value.room)) throw new Error('Room name is invalid.');
  if (!DID_RE.test(value.did)) throw new Error('DID is not a canonical Ed25519 did:key.');
  if (!SIG_RE.test(value.signature)) throw new Error('Signature must be 86 base64url characters.');
  if (!NONCE_RE.test(String(value.nonce))) throw new Error('Nonce must contain 1–19 ASCII digits.');
  if (typeof value.text !== 'string' || !value.text || Array.from(value.text).length > 4096) throw new Error('Message text must contain 1–4,096 characters.');
  return { baseUrl: origin, room: value.room, did: value.did, signature: value.signature, nonce: String(value.nonce), text: value.text };
}

export async function proxyPublish(input, fetcher = fetch) {
  const payload = validatePublishPayload(input);
  const response = await fetcher(`${payload.baseUrl}/r/${payload.room}?format=json`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'technocore-did-studio/0.2.0' },
    body: JSON.stringify({ did: payload.did, sig: payload.signature, nonce: payload.nonce, text: payload.text }),
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) throw new Error('Technocore response exceeded the safety limit.');
  if (!response.ok) throw new Error(`Technocore returned HTTP ${response.status}: ${body.slice(0, 1000).replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ') || 'no response body'}`);
  let data;
  try { data = JSON.parse(body); } catch { throw new Error('Technocore returned a non-JSON response.'); }
  const posted = data?.posted;
  const nonceMatches = posted && String(posted.nonce) === payload.nonce;
  const seqValid = posted && Number.isInteger(posted.seq) && posted.seq > 0;
  if (data?.room !== payload.room || posted?.from !== payload.did || posted?.text !== payload.text || !nonceMatches || !seqValid || typeof posted.ts !== 'string') {
    throw new Error('Technocore response did not match the signed message; publication cannot be confirmed.');
  }
  return { room: data.room, seq: posted.seq, timestamp: posted.ts, did: posted.from, nonce: String(posted.nonce), text: posted.text };
}
