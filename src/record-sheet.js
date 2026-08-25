function hasValue(value) {
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

export function recordProgress({ did, lobbyRecord, contribution, technocoreRecord } = {}) {
  return { completed: [did, lobbyRecord, contribution, technocoreRecord].filter(hasValue).length, total: 4 };
}

function publicationLine(record) {
  return record ? `${record.room} #${record.seq} — ${record.timestamp}` : '—';
}

function contributionLines(contribution) {
  if (!contribution) return ['Contribution format: —', 'Contribution URL: —'];
  if (typeof contribution === 'string') return ['Contribution format: —', `Contribution URL: ${contribution}`];
  return [`Contribution format: ${contribution.formatLabel}`, `Contribution URL: ${contribution.url}`];
}

export function formatRecordSheet({ did, lobbyRecord, contribution, technocoreRecord } = {}) {
  const progress = recordProgress({ did, lobbyRecord, contribution, technocoreRecord });
  return [
    'TECHNOCORE PUBLIC RECORD SHEET',
    '===============================',
    `Progress: ${progress.completed} of ${progress.total}`,
    '',
    `Your DID: ${did || '—'}`,
    `Lobby record: ${publicationLine(lobbyRecord)}`,
    ...contributionLines(contribution),
    `Technocore record: ${publicationLine(technocoreRecord)}`,
    '',
    'Lobby evidence:',
    lobbyRecord ? `DID: ${lobbyRecord.did}\nNonce: ${lobbyRecord.nonce}\nText: ${lobbyRecord.text}` : '—',
    '',
    'Technocore evidence:',
    technocoreRecord ? `DID: ${technocoreRecord.did}\nNonce: ${technocoreRecord.nonce}\nText: ${technocoreRecord.text}` : '—',
    '',
    'SECURITY NOTICE',
    'This sheet contains public evidence only. It never contains your private seed, encrypted identity backup, identity.pem, or passphrase.',
    '',
  ].join('\n');
}
