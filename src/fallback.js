const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/u;
const NONCE_RE = /^[0-9]{1,19}$/u;

// Verify a pasted Technocore JSON response against the message the user just
// signed. Mirrors the server-side proxy check (proxyPublish) so a fallback
// publication is only recorded when every field matches — never on shape alone.
export function verifyFallbackResponse(raw, signed, { room, origin } = {}) {
  if (!signed) throw new Error('Sign a message before saving a fallback publication.');
  let data;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { throw new Error('Paste the exact JSON response Technocore returned.'); }
  } else if (raw && typeof raw === 'object') {
    data = raw;
  } else {
    throw new Error('Paste the exact JSON response Technocore returned.');
  }
  const posted = data?.posted;
  if (!data || typeof data.room !== 'string' || !posted || typeof posted !== 'object') {
    throw new Error('That response is missing the expected room/posted fields.');
  }
  if (room && data.room !== room) throw new Error('The response room does not match the message you signed.');
  if (!NAME_RE.test(data.room)) throw new Error('The response room name is invalid.');
  if (posted.from !== signed.did) throw new Error('The response was signed by a different DID than the active identity.');
  if (posted.text !== signed.text) throw new Error('The response text does not match the message you signed.');
  if (String(posted.nonce) !== String(signed.nonce)) throw new Error('The response nonce does not match the message you signed.');
  if (!NONCE_RE.test(String(posted.nonce))) throw new Error('The response nonce is invalid.');
  if (!Number.isInteger(posted.seq) || posted.seq <= 0) throw new Error('The response sequence is invalid.');
  if (typeof posted.ts !== 'string' || !Number.isFinite(Date.parse(posted.ts))) throw new Error('The response timestamp is invalid.');
  return {
    room: data.room,
    seq: posted.seq,
    timestamp: posted.ts,
    did: posted.from,
    nonce: String(posted.nonce),
    text: posted.text,
    origin: origin || 'https://technocore.chat',
  };
}
