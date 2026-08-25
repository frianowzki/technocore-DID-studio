const INVISIBLE_RE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;

export function validateIntroduction(input, did) {
  if (!did?.startsWith('did:key:')) throw new Error('Unlock your DID before recording an introduction.');
  const text = typeof input?.text === 'string' ? input.text.replace(INVISIBLE_RE, ' ').trim() : '';
  if (!text) throw new Error('Introduction has no visible text.');
  const prefixLength = Array.from(`Agent introduction by ${did}: `).length;
  if (Array.from(text).length + prefixLength > 4096) throw new Error('Introduction exceeds the signed message maximum of 4,096 characters.');
  return { text };
}

export function buildIntroductionMessage(introduction, did) {
  return `Agent introduction by ${did}: ${introduction.text}`;
}
