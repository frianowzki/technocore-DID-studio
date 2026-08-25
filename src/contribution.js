export const CONTRIBUTION_FORMATS = Object.freeze({
  video: 'Video or stream',
  'x-thread': 'X thread',
  written: 'Written piece',
  diagram: 'Diagram',
  translation: 'Translation',
  code: 'Code or tool',
  other: 'Whatever you make',
});

export function validateContribution(input, did) {
  if (!did?.startsWith('did:key:')) throw new Error('Unlock your DID before recording a contribution.');
  if (!Object.hasOwn(CONTRIBUTION_FORMATS, input?.format)) throw new Error('Choose what you are making.');
  let url;
  try { url = new URL(input.url); } catch { throw new Error('Paste a complete public contribution URL.'); }
  if (url.protocol !== 'https:') throw new Error('The public contribution URL must use HTTPS.');
  return {
    format: input.format,
    formatLabel: CONTRIBUTION_FORMATS[input.format],
    url: url.href,
  };
}

export function buildContributionMessage(contribution, did) {
  return `Public contribution [${contribution.format}]: ${contribution.formatLabel} by ${did}. Mentions @flop_labs. Public URL: ${contribution.url}`;
}

function publicationEvidence(record) {
  if (!record) return null;
  return {
    room: record.room,
    sequence: record.seq,
    timestamp: record.timestamp,
    did: record.did,
    nonce: record.nonce,
    text: record.text,
  };
}

export function createEvidenceBackup({ did, contribution, records = {}, exportedAt = new Date().toISOString() } = {}) {
  return {
    format: 'technocore-public-evidence',
    version: 1,
    exportedAt,
    did: did || null,
    contribution: contribution ? {
      format: contribution.format,
      formatLabel: contribution.formatLabel,
      url: contribution.url,
      preparedMessage: did ? buildContributionMessage(contribution, did) : null,
    } : null,
    publications: {
      lobby: publicationEvidence(records.lobby),
      technocore: publicationEvidence(records.technocore),
    },
    security: 'Public evidence only. No private seed, encrypted identity backup, identity.pem, or passphrase.',
  };
}
