import {
  createDid,
  decryptPortableBackup,
  encryptIdentity,
  encryptSeedBackup,
  generateSeed,
  nextNonce,
  nextNonceAfter,
  signMessage,
  signedMessageUrl,
} from './crypto.js';

import { formatRecordSheet, recordProgress } from './record-sheet.js';
import { filterFeed, relativeTime, shortAuthor } from './feed.js';
import { buildContributionMessage, createEvidenceBackup, validateContribution } from './contribution.js';
import { buildIntroductionMessage, validateIntroduction } from './introduction.js';
import { decryptIdentityPem } from './pem.js';
import { mnemonicToSeed, seedToMnemonic } from './mnemonic.js';
import { verifyFallbackResponse } from './fallback.js';
import {
  clearDidHistory,
  createHistoryBackup,
  mergeDidHistory,
  provenanceLabel,
  readDidHistory,
  recordsFromHistoryBackup,
  writeDidHistory,
} from './history.js';
import { highestNonce, nextNonceFor, rememberNonce } from './nonce-store.js';

const state = {
  seed: null,
  did: null,
  backup: null,
  signed: null,
  publication: null,
  identitySource: null,
  introduction: null,
  contribution: null,
  records: { lobby: null, technocore: null },
  history: [],
  highlightKey: null,
  activation: 0,
  feedMessages: [],
  feedFilter: 'all',
  feedLoading: false,
  extraRooms: [],
};
const byId = (id) => document.getElementById(id);
const status = byId('status');

let statusTimer = null;
const DEFAULT_STATUS = 'Ready. Start with a new identity or restore an encrypted backup.';

function announce(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  // Errors stay until the next action; transient success/info clears itself so
  // the sticky status bar does not keep an outdated notice like "Imported 1…".
  if (kind !== 'error') {
    statusTimer = setTimeout(() => {
      status.textContent = DEFAULT_STATUS;
      status.dataset.kind = 'info';
      statusTimer = null;
    }, 6000);
  }
}

function publicationLabel(record) {
  return record ? `${record.room} #${record.seq}` : '—';
}

function updateOwnedRecord(kind, record) {
  byId(`owned-${kind}-status`).textContent = record ? `Recorded #${record.seq}` : 'No saved record';
  byId(`owned-${kind}-seq`).textContent = record ? String(record.seq) : '—';
  byId(`owned-${kind}-nonce`).textContent = record?.nonce || '—';
  byId(`owned-${kind}-text`).textContent = record?.text || '—';
}

function renderDidHistory() {
  const list = byId('did-history-list');
  if (!list) return;
  const lobbyCount = state.history.filter((item) => item.room === 'lobby').length;
  const contributionCount = state.history.filter((item) => item.room === 'technocore').length;
  byId('did-history-total').textContent = String(state.history.length);
  byId('did-history-lobby-count').textContent = String(lobbyCount);
  byId('did-history-contribution-count').textContent = String(contributionCount);
  byId('did-history-did').textContent = state.did || '—';
  list.replaceChildren();
  if (!state.did) {
    list.append(feedElement('p', 'feed-empty', 'Unlock your encrypted identity JSON or identity.pem to load its public history.'));
    return;
  }
  if (!state.history.length) {
    list.append(feedElement('p', 'feed-empty', 'No saved or currently retained records were found for this DID. Import a public evidence backup if you already have one.'));
    return;
  }
  for (const record of state.history) {
    const item = feedElement('article', `feed-item feed-${record.kind}`);
    item.setAttribute('aria-label', `${record.kind} in ${record.room}, sequence ${record.seq}`);
    if (state.highlightKey === `${record.room}:${record.seq}`) {
      item.classList.add('feed-item-new');
      item.setAttribute('aria-current', 'true');
    }
    const head = feedElement('header', 'feed-item-head');
    const identity = feedElement('div', 'feed-item-identity');
    identity.append(feedElement('span', 'feed-kind', record.kind), feedElement('span', 'feed-sequence', `${record.room} #${record.seq}`));
    const time = feedElement('time', '', relativeTime(record.timestamp));
    time.dateTime = record.timestamp;
    head.append(identity, time);
    const body = feedElement('p', 'feed-message', record.text);
    const meta = feedElement('footer', 'feed-meta');
    meta.append(feedElement('span', 'feed-provenance', provenanceLabel(record)));
    if (record.origin && record.origin !== 'https://technocore.chat') {
      let host = record.origin;
      try { host = new URL(record.origin).host; } catch {}
      meta.append(feedElement('span', 'feed-origin', `@ ${host}`));
    }
    if (record.seenAt && record.source !== 'network' && record.source !== 'verified') {
      meta.append(feedElement('span', 'feed-seen', `seen ${relativeTime(record.seenAt)}`));
    }
    if (record.nonce !== null) meta.append(feedElement('span', '', `nonce ${record.nonce}`));
    item.append(head, body, meta);
    list.append(item);
  }
}

function showDidHistoryTab({ focus = false } = {}) {
  const historyTab = document.querySelector('[data-history-tab="owned"]');
  if (!historyTab) return;
  for (const button of document.querySelectorAll('[data-history-tab]')) {
    button.setAttribute('aria-selected', String(button === historyTab));
    button.tabIndex = button === historyTab ? 0 : -1;
  }
  for (const panel of document.querySelectorAll('[data-history-panel]')) {
    panel.hidden = panel.dataset.historyPanel !== 'owned';
  }
  if (focus) historyTab.focus();
}

function recordVerifiedPublicationForDid(did, publication) {
  if (!did || publication?.did !== did) return;
  const merged = mergeDidHistory({ did, existing: readDidHistory(did), publications: [publication] });
  writeDidHistory(did, merged);
  if (did === state.did) syncDidHistory();
}

function syncDidHistory(imported = []) {
  if (!state.did) {
    state.history = [];
    renderDidHistory();
    return;
  }
  state.history = mergeDidHistory({
    did: state.did,
    existing: [...readDidHistory(state.did), ...state.history],
    feed: state.feedMessages,
    publications: Object.values(state.records),
    imported,
  });
  writeDidHistory(state.did, state.history);
  for (const room of ['lobby', 'technocore']) {
    if (!state.records[room]) state.records[room] = state.history.find((item) => item.room === room) || null;
  }
  renderDidHistory();
}

function updateRecordBoard() {
  const data = {
    did: state.did,
    lobbyRecord: state.records.lobby,
    contribution: state.contribution,
    technocoreRecord: state.records.technocore,
  };
  const progress = recordProgress(data);
  byId('record-count').textContent = `${progress.completed} of ${progress.total}`;
  byId('record-progress').style.width = `${(progress.completed / progress.total) * 100}%`;
  byId('record-did').textContent = state.did || '—';
  byId('record-lobby').textContent = publicationLabel(state.records.lobby);
  byId('record-contribution').textContent = state.contribution ? `${state.contribution.formatLabel}: ${state.contribution.url}` : '—';
  byId('record-technocore').textContent = publicationLabel(state.records.technocore);
  byId('did-history-did').textContent = state.did || '—';
  updateOwnedRecord('introduction', state.records.lobby);
  updateOwnedRecord('contribution', state.records.technocore);
  byId('backup-did').textContent = state.did || '—';
  byId('backup-lobby-seq').textContent = state.records.lobby ? String(state.records.lobby.seq) : '—';
  byId('backup-contribution').textContent = state.contribution ? `${state.contribution.formatLabel}: ${state.contribution.url}` : '—';
  byId('backup-technocore-seq').textContent = state.records.technocore ? String(state.records.technocore.seq) : '—';
  if (state.identitySource === 'generated') {
    byId('pem-status').textContent = 'not created here — encrypted JSON downloaded';
    byId('passphrase-status').textContent = 'chosen — never displayed';
  } else if (state.identitySource === 'seed-restored') {
    byId('pem-status').textContent = 'not created here — encrypted seed-only JSON unlocked';
    byId('passphrase-status').textContent = 'entered — never displayed';
  } else if (state.identitySource === 'pem-restored') {
    byId('pem-status').textContent = 'encrypted identity.pem unlocked locally';
    byId('passphrase-status').textContent = 'entered — never displayed';
  } else if (state.identitySource === 'phrase-restored') {
    byId('pem-status').textContent = 'restored from 24-word recovery phrase';
    byId('passphrase-status').textContent = 'phrase entered — never displayed';
  } else if (state.identitySource === 'restored') {
    byId('pem-status').textContent = 'not created here — JSON backup unlocked';
    byId('passphrase-status').textContent = 'entered — never displayed';
  } else {
    byId('pem-status').textContent = 'not created yet';
    byId('passphrase-status').textContent = 'not chosen yet';
  }
}

function resetIdentityBoundState() {
  state.signed = null;
  state.publication = null;
  state.introduction = null;
  state.contribution = null;
  state.records = { lobby: null, technocore: null };
  state.history = [];
  byId('signed-result').hidden = true;
  byId('publication-result').hidden = true;
  byId('publish-check').checked = false;
  byId('introduction-form').reset();
  byId('contribution-form').reset();
}

function setIdentity(seed, did, backup = null, source = 'restored') {
  if (state.did !== did) resetIdentityBoundState();
  state.activation += 1;
  state.seed = seed;
  state.did = did;
  state.backup = backup;
  state.identitySource = source;
  byId('did-value').textContent = did;
  byId('identity-empty').hidden = true;
  byId('identity-ready').hidden = false;
  byId('sign-fieldset').disabled = false;
  byId('seed-backup-fieldset').disabled = false;
  byId('download-backup').disabled = !backup;
  byId('current-did').value = did;
  document.body.dataset.identity = 'ready';
  syncDidHistory();
  updateRecordBoard();
  // Suggest a nonce that respects this DID's per-room high-water mark.
  byId('nonce').value = nonceForRoom();
}

function downloadJson(data, filename) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function copy(value, label) {
  await navigator.clipboard.writeText(value);
  announce(`${label} copied.`, 'success');
}

byId('generate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const passphrase = byId('new-passphrase').value;
  const confirmation = byId('confirm-passphrase').value;
  if (!byId('safety-check').checked) return announce('Confirm the safety note before generating an identity.', 'error');
  if (passphrase !== confirmation) return announce('Passphrases do not match.', 'error');
  const button = byId('generate-button');
  button.disabled = true;
  button.textContent = 'Generating…';
  try {
    const seed = generateSeed();
    const did = await createDid(seed);
    const backup = await encryptIdentity(seed, did, passphrase);
    setIdentity(seed, did, backup, 'generated');
    downloadJson(backup, privateBackupFilename(backup, did));
    byId('generate-form').reset();
    announce('Identity generated. Your encrypted backup was downloaded; keep it and the passphrase separately.', 'success');
    byId('identity').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    announce(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Generate encrypted identity';
  }
});

byId('restore-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = byId('backup-file').files[0];
  if (!file) return announce('Choose an identity backup file.', 'error');
  try {
    const contents = await file.text();
    const passphrase = byId('restore-passphrase').value;
    let backup = null;
    let seed;
    let source;
    if (contents.includes('-----BEGIN ENCRYPTED PRIVATE KEY-----')) {
      seed = await decryptIdentityPem(contents, passphrase);
      source = 'pem-restored';
    } else {
      backup = JSON.parse(contents);
      const restored = await decryptPortableBackup(backup, passphrase);
      seed = restored.seed;
      source = restored.format === 'technocore-seed-backup' ? 'seed-restored' : 'restored';
    }
    const did = await createDid(seed);
    setIdentity(seed, did, backup, source);
    byId('restore-form').reset();
    announce(source === 'pem-restored' ? 'Encrypted identity.pem unlocked locally for this tab only.' : 'Identity restored in memory for this tab only.', 'success');
    byId('identity').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    announce(error.message || 'Could not restore that backup.', 'error');
  }
});

function privateBackupFilename(backup, did) {
  const prefix = backup?.format === 'technocore-seed-backup' ? 'technocore-seed-backup' : 'technocore-identity';
  return `${prefix}-${did.slice(-8)}.json`;
}

byId('copy-did').addEventListener('click', () => copy(state.did, 'DID'));
byId('download-backup').addEventListener('click', () => {
  if (!state.backup) return announce('Restore or generate an identity first.', 'error');
  downloadJson(state.backup, privateBackupFilename(state.backup, state.did));
  announce('Encrypted backup downloaded again.', 'success');
});

byId('seed-backup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.seed || !state.did) return announce('Unlock an identity before creating a seed-only backup.', 'error');
  const passphrase = byId('seed-backup-passphrase').value;
  if (passphrase !== byId('seed-backup-confirmation').value) return announce('Seed-backup passphrases do not match.', 'error');
  if (!byId('seed-backup-check').checked) return announce('Confirm the seed-backup safety acknowledgement.', 'error');
  const button = byId('download-seed-backup');
  button.disabled = true;
  button.textContent = 'Encrypting seed backup…';
  try {
    const backup = await encryptSeedBackup(state.seed, state.did, passphrase);
    downloadJson(backup, privateBackupFilename(backup, state.did));
    byId('seed-backup-form').reset();
    announce('Encrypted seed-only backup downloaded. Store its separate passphrase somewhere else.', 'success');
  } catch (error) {
    announce(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Download encrypted seed-only backup';
  }
});
byId('switch-identity').addEventListener('click', () => {
  state.seed = null;
  state.did = null;
  state.backup = null;
  state.identitySource = null;
  resetIdentityBoundState();
  byId('identity-empty').hidden = false;
  byId('identity-ready').hidden = true;
  byId('sign-fieldset').disabled = true;
  byId('seed-backup-fieldset').disabled = true;
  byId('download-backup').disabled = true;
  byId('seed-backup-form').reset();
  hideMnemonic();
  byId('current-did').value = '';
  document.body.dataset.identity = 'locked';
  renderDidHistory();
  updateRecordBoard();
  announce('Identity removed from this tab. Choose an encrypted JSON backup or identity.pem to unlock.', 'success');
  byId('create').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// Per-DID + room nonce that is always strictly greater than the last one this
// browser used for that key. Falls back to the clock before an identity loads.
function nonceForRoom(room = byId('room')?.value || 'lobby') {
  if (!state.did) return nextNonce();
  return nextNonceFor(state.did, room);
}

byId('nonce').value = nonceForRoom();
byId('refresh-nonce').addEventListener('click', () => { byId('nonce').value = nonceForRoom(); });
// Re-suggest a valid nonce whenever the target room changes.
byId('room').addEventListener('change', () => { byId('nonce').value = nonceForRoom(); });

function hideMnemonic() {
  byId('mnemonic-words').replaceChildren();
  byId('mnemonic-words').hidden = true;
  byId('mnemonic-actions').hidden = true;
  byId('reveal-mnemonic').hidden = false;
  const verifyForm = byId('mnemonic-verify-form');
  verifyForm.hidden = true;
  byId('mnemonic-verify-fields').replaceChildren();
  revealedMnemonic = null;
}

let revealedMnemonic = null;

byId('reveal-mnemonic').addEventListener('click', async () => {
  if (!state.seed) return announce('Unlock an identity first.', 'error');
  try {
    revealedMnemonic = (await seedToMnemonic(state.seed)).split(' ');
    const list = byId('mnemonic-words');
    list.replaceChildren();
    for (const word of revealedMnemonic) list.append(feedElement('li', 'mnemonic-word', word));
    list.hidden = false;
    byId('mnemonic-actions').hidden = false;
    byId('reveal-mnemonic').hidden = true;
    byId('mnemonic-words').focus?.();
    announce('Recovery phrase shown. Write it down offline; anyone with these 24 words controls this DID.', 'info');
  } catch (error) {
    announce(error.message, 'error');
  }
});
byId('hide-mnemonic').addEventListener('click', hideMnemonic);
byId('copy-mnemonic').addEventListener('click', async () => {
  const words = [...byId('mnemonic-words').querySelectorAll('li')].map((item) => item.textContent).join(' ');
  if (!words) return;
  await copy(words, 'Recovery phrase');
});

// Verify-phrase step: ask for 3 random words so the user proves they copied
// the phrase down correctly before trusting it as a sole backup.
byId('verify-mnemonic').addEventListener('click', () => {
  if (!revealedMnemonic) return;
  const indices = [];
  while (indices.length < 3) {
    const candidate = Math.floor(Math.random() * revealedMnemonic.length);
    if (!indices.includes(candidate)) indices.push(candidate);
  }
  indices.sort((a, b) => a - b);
  const fields = byId('mnemonic-verify-fields');
  fields.replaceChildren();
  for (const index of indices) {
    const label = feedElement('label', 'mnemonic-verify-field', `Word #${index + 1}`);
    const input = document.createElement('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.wordIndex = String(index);
    input.setAttribute('aria-label', `Recovery word number ${index + 1}`);
    label.append(input);
    fields.append(label);
  }
  byId('mnemonic-verify-form').hidden = false;
  fields.querySelector('input')?.focus();
});

byId('check-mnemonic').addEventListener('click', () => {
  if (!revealedMnemonic) return;
  const inputs = [...byId('mnemonic-verify-fields').querySelectorAll('input')];
  const allCorrect = inputs.length > 0 && inputs.every((input) => input.value.trim().toLowerCase() === revealedMnemonic[Number(input.dataset.wordIndex)]);
  if (allCorrect) {
    byId('mnemonic-verify-form').hidden = true;
    byId('mnemonic-verify-fields').replaceChildren();
    announce('Recovery phrase verified. You transcribed it correctly.', 'success');
  } else {
    announce('Those words do not match. Check your written copy against the list above and try again.', 'error');
  }
});

byId('mnemonic-restore-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const phrase = byId('mnemonic-input').value;
  if (!phrase.trim()) return announce('Paste your 24-word recovery phrase first.', 'error');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const seed = await mnemonicToSeed(phrase);
    const did = await createDid(seed);
    setIdentity(seed, did, null, 'phrase-restored');
    byId('mnemonic-input').value = '';
    announce('Identity restored from recovery phrase for this tab only.', 'success');
    byId('identity').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    announce(error.message || 'Could not restore from that recovery phrase.', 'error');
  } finally {
    button.disabled = false;
  }
});

function renderPublication(publication) {
  state.publication = publication;
  if (publication.room === 'lobby' || publication.room === 'technocore') state.records[publication.room] = publication;
  byId('published-room').textContent = publication.room;
  byId('published-seq').textContent = String(publication.seq);
  byId('published-timestamp').textContent = publication.timestamp;
  byId('published-did').textContent = publication.did;
  byId('published-nonce').textContent = publication.nonce;
  byId('published-text').textContent = publication.text;
  byId('publication-result').hidden = false;
  byId('result-state').textContent = 'Signed and published — URL consumed';
  byId('request-url').value = '';
  byId('copy-url').disabled = true;
  byId('open-request').disabled = true;
  byId('fallback-note').textContent = 'Published successfully. This signed URL has been consumed and cannot be opened or submitted again.';
  state.signed = null;
  syncDidHistory();
  updateRecordBoard();
  // Surface the new record where it durably lives: the DID history. The public
  // live feed is a fast-scrolling ring, so a fresh post is often already buried.
  state.highlightKey = `${publication.room}:${publication.seq}`;
  showDidHistoryTab();
  renderDidHistory();
  const historyList = byId('did-history-list');
  const highlighted = historyList?.querySelector('.feed-item-new');
  if (highlighted) highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => { state.highlightKey = null; renderDidHistory(); }, 8000);
  setTimeout(loadFeed, 500);
}

async function publishSignedMessage(signed, room, baseUrl) {
  const response = await fetch('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseUrl, room, did: signed.did, signature: signed.signature, nonce: signed.nonce, text: signed.text }),
  });
  let data = {};
  try { data = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const error = new Error(data.error || `Local publish service returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return data;
}

byId('sign-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.seed) return announce('Generate or restore an identity first.', 'error');
  const wantsPublish = event.submitter?.value === 'publish';
  if (wantsPublish && !byId('publish-check').checked) return announce('Confirm the public-write checkbox before using Sign & publish.', 'error');
  const buttons = [byId('sign-only-button'), byId('sign-publish-button')];
  buttons.forEach((button) => { button.disabled = true; });
  byId('sign-publish-button').textContent = wantsPublish ? 'Publishing…' : 'Sign & publish';
  byId('publication-result').hidden = true;
  state.publication = null;
  try {
    const room = byId('room').value;
    const baseUrl = byId('server').value;
    const activationAtSign = state.activation;
    const didAtSign = state.did;
    const signed = await signMessage(state.seed, room, byId('nonce').value, byId('message').value);
    signed.url = `${signedMessageUrl(baseUrl, room, signed.did, signed.signature, signed.nonce, signed.text)}?format=json`;
    state.signed = signed;
    byId('canonical').textContent = `${room}|${signed.nonce}|${signed.text}`;
    byId('signature').textContent = signed.signature;
    byId('request-url').value = signed.url;
    byId('copy-url').disabled = false;
    byId('open-request').disabled = false;
    byId('fallback-note').textContent = 'Fallback only: If automatic publishing is unavailable, open this result URL once. Do not open it after a successful publish; signed URLs are single-use.';
    byId('signed-result').hidden = false;
    byId('result-state').textContent = 'Signed — not published';
    if (!wantsPublish) {
      announce('Message signed locally. Nothing has been published yet.', 'success');
      return;
    }
    try {
      const publication = await publishSignedMessage(signed, room, baseUrl);
      if (state.activation !== activationAtSign || state.did !== didAtSign) {
        announce('Identity changed before this publication resolved. The verified record was kept only for the DID that signed it.', 'error');
        if (publication.did === didAtSign) recordVerifiedPublicationForDid(didAtSign, publication);
        return;
      }
      renderPublication(publication);
      rememberNonce(didAtSign, publication.room, publication.nonce);
      byId('nonce').value = nonceForRoom();
      announce(`Published and verified in ${publication.room} as sequence ${publication.seq}. Saved to your DID history — the live feed scrolls fast, so a fresh post is often already buried there.`, 'success');
    } catch (error) {
      const nonceReuse = error.message.match(/nonce [0-9]+ is not greater than ([0-9]+)/u);
      if (nonceReuse) {
        rememberNonce(state.did, byId('room').value, nonceReuse[1]);
        byId('nonce').value = nextNonceAfter(nonceReuse[1]);
        byId('publish-check').checked = false;
        byId('signed-result').hidden = true;
        state.signed = null;
        announce('Nonce rejected as already used. The old signed URL is now invalidated; review the room, then sign again with the fresh nonce.', 'error');
      } else if (error.status === 404) {
        announce('Automatic publishing is unavailable on this static host. The message is still only signed; use “Open result URL & publish”.', 'error');
      } else {
        announce(`Publication was not confirmed: ${error.message} Check the room before retrying or using the fallback URL.`, 'error');
      }
    }
  } catch (error) {
    announce(error.message, 'error');
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    byId('sign-publish-button').textContent = 'Sign & publish';
  }
});

byId('copy-url').addEventListener('click', () => copy(state.signed.url, 'Signed request URL'));
byId('open-request').addEventListener('click', () => {
  if (!state.signed) return;
  if (!confirm('This fallback URL publicly writes the signed message and displays the Technocore JSON response. Continue?')) return;
  window.open(state.signed.url, '_blank', 'noopener,noreferrer');
  byId('fallback-capture').open = true;
  announce('Result URL opened in a new tab. Copy the JSON response and paste it below to save this publication.', 'info');
});

byId('capture-fallback').addEventListener('click', () => {
  if (!state.signed) return announce('Sign a message before saving a fallback publication.', 'error');
  try {
    const publication = verifyFallbackResponse(byId('fallback-json').value, state.signed, { room: byId('room').value, origin: byId('server').value });
    const didAtCapture = state.did;
    if (publication.did !== didAtCapture) throw new Error('That response belongs to a different DID than the active identity.');
    renderPublication(publication);
    rememberNonce(didAtCapture, publication.room, publication.nonce);
    byId('fallback-json').value = '';
    byId('fallback-capture').open = false;
    byId('nonce').value = nonceForRoom();
    announce(`Fallback publication saved: ${publication.room} sequence ${publication.seq}. It is now in your DID history.`, 'success');
  } catch (error) {
    announce(error.message || 'Could not verify that fallback response.', 'error');
  }
});
byId('copy-evidence').addEventListener('click', () => {
  if (!state.publication) return;
  const item = state.publication;
  copy(`Technocore publication\nRoom: ${item.room}\nSequence: ${item.seq}\nTimestamp: ${item.timestamp}\nDID: ${item.did}\nNonce: ${item.nonce}\nText: ${item.text}`, 'Publication evidence');
});

byId('go-introduction').addEventListener('click', () => byId('introduction').scrollIntoView({ behavior: 'smooth', block: 'start' }));
byId('go-contribution').addEventListener('click', () => byId('contribution').scrollIntoView({ behavior: 'smooth', block: 'start' }));

function preparePublicMessage(room, message, announcement) {
  byId('room').value = room;
  byId('nonce').value = nonceForRoom(room);
  byId('message').value = message;
  byId('publish-check').checked = false;
  byId('signed-result').hidden = true;
  byId('publication-result').hidden = true;
  state.signed = null;
  state.publication = null;
  announce(announcement, 'success');
  byId('sign').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

byId('introduction-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    state.introduction = validateIntroduction({ text: byId('introduction-text').value }, state.did);
    byId('introduction-text').value = state.introduction.text;
    preparePublicMessage(
      'lobby',
      buildIntroductionMessage(state.introduction, state.did),
      'Introduction ready for room lobby. Review it before signing or publishing.',
    );
  } catch (error) {
    announce(error.message, 'error');
  }
});

byId('contribution-form').addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    const form = new FormData(event.currentTarget);
    state.contribution = validateContribution({
      format: form.get('contribution-format'),
      url: byId('contribution-url').value,
    }, state.did);
    byId('contribution-url').value = state.contribution.url;
    updateRecordBoard();
    preparePublicMessage(
      'technocore',
      buildContributionMessage(state.contribution, state.did),
      'Contribution saved for room technocore. Review it before signing or publishing.',
    );
  } catch (error) {
    announce(error.message, 'error');
  }
});

function downloadPublicRecordSheet() {
  const sheet = formatRecordSheet({ did: state.did, lobbyRecord: state.records.lobby, contribution: state.contribution, technocoreRecord: state.records.technocore });
  const suffix = state.did ? `-${state.did.slice(-8)}` : '';
  downloadText(sheet, `technocore-record-sheet${suffix}.txt`);
  announce('Public record sheet downloaded. No secret key or passphrase was included.', 'success');
}

function downloadPublicEvidence() {
  const evidence = createEvidenceBackup({ did: state.did, contribution: state.contribution, records: state.records });
  const suffix = state.did ? `-${state.did.slice(-8)}` : '';
  downloadJson(evidence, `technocore-public-evidence${suffix}.json`);
  announce('Public evidence backup downloaded with room names, sequences, timestamps, DID, and nonces.', 'success');
}

for (const id of ['download-record-sheet', 'download-record-sheet-2']) byId(id).addEventListener('click', downloadPublicRecordSheet);
for (const id of ['download-evidence-backup', 'download-evidence-backup-2']) byId(id).addEventListener('click', downloadPublicEvidence);

function feedElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderFeed() {
  const list = byId('feed-list');
  const messages = filterFeed(state.feedMessages, state.feedFilter, state.did);
  list.replaceChildren();
  if (!messages.length) {
    let emptyText;
    if (state.feedFilter === 'mine') {
      emptyText = state.did
        ? 'None of your posts are in the current retained window. The live feed only keeps the newest entries per room; your DID history keeps them permanently.'
        : 'Unlock your identity to filter the feed to your own posts.';
    } else {
      emptyText = `No ${state.feedFilter === 'all' ? 'activity' : `${state.feedFilter}s`} in the current window.`;
    }
    list.append(feedElement('p', 'feed-empty', emptyText));
    return;
  }
  for (const message of messages) {
    const item = feedElement('article', `feed-item feed-${message.kind}`);
    item.setAttribute('aria-label', `${message.kind} in ${message.room}, sequence ${message.seq}`);
    if (state.did && message.from === state.did) item.classList.add('feed-item-mine');
    const head = feedElement('header', 'feed-item-head');
    const identity = feedElement('div', 'feed-item-identity');
    identity.append(feedElement('span', 'feed-kind', message.kind), feedElement('span', 'feed-sequence', `${message.room} #${message.seq}`));
    const time = feedElement('time', '', relativeTime(message.timestamp));
    time.dateTime = message.timestamp;
    head.append(identity, time);
    const body = feedElement('p', 'feed-message', message.text);
    const meta = feedElement('footer', 'feed-meta');
    const author = feedElement('code', '', shortAuthor(message.from));
    author.title = message.from;
    meta.append(author);
    if (message.nonce !== null) meta.append(feedElement('span', '', `nonce ${message.nonce}`));
    item.append(head, body, meta);
    list.append(item);
  }
}

async function loadFeed() {
  if (state.feedLoading) return;
  state.feedLoading = true;
  byId('feed-list').setAttribute('aria-busy', 'true');
  byId('refresh-feed').disabled = true;
  try {
    const query = state.extraRooms.length ? `?rooms=${encodeURIComponent(state.extraRooms.join(','))}` : '';
    const response = await fetch(`/api/feed${query}`, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('feed request failed');
    const data = await response.json();
    if (!Array.isArray(data.messages) || typeof data.updatedAt !== 'string') throw new Error('invalid feed response');
    state.feedMessages = data.messages;
    renderFeed();
    syncDidHistory();
    updateRecordBoard();
    const roomCount = Array.isArray(data.rooms) ? data.rooms.length : 2;
    byId('feed-status').textContent = data.stale ? 'Cached — upstream unavailable' : `Live — ${data.messages.length} entries across ${roomCount} room${roomCount === 1 ? '' : 's'}`;
    byId('feed-updated').textContent = `Updated ${relativeTime(data.updatedAt)}`;
    byId('feed-dot').classList.toggle('is-stale', Boolean(data.stale));
    byId('feed-dot').classList.remove('is-error');
  } catch {
    byId('feed-status').textContent = 'Feed unavailable';
    byId('feed-updated').textContent = 'Run with npm run serve or configure a serverless feed proxy';
    byId('feed-dot').classList.add('is-error');
    if (!state.feedMessages.length) {
      byId('feed-list').replaceChildren(feedElement('p', 'feed-empty', 'The live feed could not be reached. Your identity and signing tools still work locally.'));
    }
  } finally {
    state.feedLoading = false;
    byId('feed-list').setAttribute('aria-busy', 'false');
    byId('refresh-feed').disabled = false;
  }
}

const historyTabs = [...document.querySelectorAll('[data-history-tab]')];
function selectHistoryTab(button, { focus = false } = {}) {
  historyTabs.forEach((item) => {
    const selected = item === button;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('[data-history-panel]').forEach((panel) => { panel.hidden = panel.dataset.historyPanel !== button.dataset.historyTab; });
  if (focus) button.focus();
}
historyTabs.forEach((button, index) => {
  button.tabIndex = button.getAttribute('aria-selected') === 'true' ? 0 : -1;
  button.addEventListener('click', () => selectHistoryTab(button));
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = historyTabs[(index + offset + historyTabs.length) % historyTabs.length];
    selectHistoryTab(next, { focus: true });
  });
});

byId('evidence-import-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!state.did) return announce('Unlock the identity that owns this backup before importing it.', 'error');
  const file = byId('evidence-file').files[0];
  if (!file) return announce('Choose a public evidence or DID-history JSON file.', 'error');
  if (file.size > 1024 * 1024) return announce('Public backups must be 1 MB or smaller.', 'error');
  try {
    const text = await file.text();
    if (/-----BEGIN|PRIVATE KEY|"seed"|"passphrase"/u.test(text)) {
      throw new Error('That file looks like a private backup. Import public evidence or DID-history JSON only.');
    }
    const imported = recordsFromHistoryBackup(JSON.parse(text), state.did);
    if (!imported.length) throw new Error('That backup does not contain any published records.');
    syncDidHistory(imported);
    updateRecordBoard();
    form.reset();
    announce(`Imported ${imported.length} public record${imported.length === 1 ? '' : 's'} for this DID.`, 'success');
  } catch (error) {
    announce(error.message || 'Could not import that public backup.', 'error');
  }
});

byId('export-history').addEventListener('click', () => {
  if (!state.did) return announce('Unlock an identity before exporting its history.', 'error');
  if (!state.history.length) return announce('There are no saved records to export yet.', 'error');
  const backup = createHistoryBackup(state.did, state.history);
  downloadJson(backup, `technocore-did-history-${state.did.slice(-8)}.json`);
  announce(`Exported ${backup.records.length} public record${backup.records.length === 1 ? '' : 's'}. No seed, passphrase, or private key is included.`, 'success');
});

byId('clear-history').addEventListener('click', () => {
  if (!state.did) return announce('Unlock an identity before clearing its history.', 'error');
  if (!confirm(`Remove this browser's saved public history for ${state.did}? This cannot be undone. Export a backup first if you want to keep it. It does not touch anything already published on Technocore.`)) return;
  clearDidHistory(state.did);
  state.history = [];
  state.records = { lobby: null, technocore: null };
  renderDidHistory();
  updateRecordBoard();
  announce('Local public history cleared for this DID. Published records still exist on Technocore.', 'success');
});

for (const button of document.querySelectorAll('[data-feed-filter]')) {
  button.addEventListener('click', () => {
    state.feedFilter = button.dataset.feedFilter;
    document.querySelectorAll('[data-feed-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    renderFeed();
  });
}
byId('refresh-feed').addEventListener('click', loadFeed);
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadFeed(); });
setInterval(() => { if (!document.hidden) loadFeed(); }, 20000);
loadFeed();

const BASE_ROOM_SET = new Set(['lobby', 'technocore']);

function renderActiveRooms() {
  const container = byId('room-picker-active');
  if (!container) return;
  container.replaceChildren();
  for (const room of state.extraRooms) {
    const chip = feedElement('span', 'room-chip');
    chip.append(feedElement('code', '', room));
    const remove = feedElement('button', 'room-chip-remove', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${room} from the live feed`);
    remove.addEventListener('click', () => {
      state.extraRooms = state.extraRooms.filter((entry) => entry !== room);
      renderActiveRooms();
      loadFeed();
    });
    chip.append(remove);
    container.append(chip);
  }
}

async function loadRoomDirectory() {
  const select = byId('room-picker-select');
  const roomOptions = byId('room-options');
  if (!select) return;
  try {
    const response = await fetch('/api/rooms', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('rooms request failed');
    const data = await response.json();
    if (!Array.isArray(data.rooms)) throw new Error('invalid rooms response');
    select.replaceChildren();
    const placeholder = feedElement('option', '', 'Choose a discovered room…');
    placeholder.value = '';
    select.append(placeholder);
    // Refresh the sign-form room datalist so it lists every discoverable room.
    if (roomOptions) {
      roomOptions.replaceChildren();
      for (const entry of data.rooms) {
        const option = document.createElement('option');
        option.value = entry.room;
        if (entry.topic) option.label = entry.topic;
        roomOptions.append(option);
      }
    }
    for (const entry of data.rooms) {
      if (BASE_ROOM_SET.has(entry.room)) continue;
      // Keep option labels short: a long upstream topic makes the native select
      // grow to its intrinsic content width and overflow the feed card.
      const bits = [];
      if (entry.topic) bits.push(entry.topic.length > 44 ? `${entry.topic.slice(0, 44).trimEnd()}…` : entry.topic);
      if (entry.atCapacity) bits.push('full · scrolls fast');
      else if (typeof entry.idleSeconds === 'number' && entry.idleSeconds > 900) bits.push(`idle ${Math.round(entry.idleSeconds / 60)}m`);
      const label = bits.length ? `${entry.room} — ${bits.join(' · ')}` : entry.room;
      const option = feedElement('option', '', label);
      option.value = entry.room;
      option.title = entry.topic || entry.room;
      select.append(option);
    }
  } catch {
    select.replaceChildren(feedElement('option', '', 'Room directory unavailable'));
  }
}

byId('room-picker-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  const select = byId('room-picker-select');
  const room = select?.value;
  if (!room) return announce('Choose a room from the list first.', 'error');
  if (BASE_ROOM_SET.has(room)) return announce('lobby and technocore are already included.', 'error');
  if (state.extraRooms.includes(room)) return announce(`${room} is already in the feed.`, 'info');
  if (state.extraRooms.length >= 6) return announce('You can add at most 6 extra rooms.', 'error');
  state.extraRooms = [...state.extraRooms, room];
  select.value = '';
  renderActiveRooms();
  announce(`Added ${room} to the live feed.`, 'success');
  loadFeed();
});
loadRoomDirectory();

for (const button of document.querySelectorAll('[data-os]')) {
  button.addEventListener('click', () => {
    document.querySelectorAll('[data-os]').forEach((item) => item.setAttribute('aria-selected', String(item === button)));
    document.querySelectorAll('[data-os-panel]').forEach((panel) => { panel.hidden = panel.dataset.osPanel !== button.dataset.os; });
  });
}

for (const button of document.querySelectorAll('[data-copy-target]')) {
  button.addEventListener('click', () => copy(byId(button.dataset.copyTarget).textContent, 'Command'));
}

function setupThemeToggle() {
  const toggle = byId('theme-toggle');
  const storageKey = 'technocore-theme';
  const applyTheme = (theme, persist = false) => {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    const label = nextTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    if (persist) {
      try { localStorage.setItem(storageKey, nextTheme); } catch {}
    }
  };

  applyTheme(document.documentElement.dataset.theme);
  toggle.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
}

function setupScrollEffects() {
  const links = [...document.querySelectorAll('.rail a[href^="#"]')];
  const sections = links.map((link) => document.querySelector(link.hash)).filter(Boolean);
  if (!links.length || !sections.length) return;

  document.documentElement.classList.add('scroll-effects');
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
  sections.forEach((section) => revealObserver.observe(section));

  let frame = null;
  const updateCurrent = () => {
    frame = null;
    const marker = Math.min(window.innerHeight * 0.35, 280);
    let current = sections[0];
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= marker) current = section;
    }
    const atDocumentEnd = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 2;
    if (atDocumentEnd) current = sections.at(-1);
    const currentHash = `#${current.id}`;
    links.forEach((link) => {
      if (link.getAttribute('href') === currentHash) link.setAttribute('aria-current', 'step');
      else link.removeAttribute('aria-current');
    });
  };
  const queueUpdate = () => {
    if (frame === null) frame = requestAnimationFrame(updateCurrent);
  };
  window.addEventListener('scroll', queueUpdate, { passive: true });
  window.addEventListener('resize', queueUpdate);
  updateCurrent();
}

setupThemeToggle();
setupScrollEffects();
updateRecordBoard();

if (!globalThis.crypto?.subtle) {
  announce('This browser does not provide the Web Crypto API. Use a current browser over HTTPS or localhost.', 'error');
  document.querySelectorAll('button[type="submit"]').forEach((button) => { button.disabled = true; });
}
