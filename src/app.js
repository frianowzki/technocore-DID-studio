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
  feedMessages: [],
  feedFilter: 'all',
  feedLoading: false,
};
const byId = (id) => document.getElementById(id);
const status = byId('status');

function announce(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
}

function publicationLabel(record) {
  return record ? `${record.room} #${record.seq}` : '—';
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
  } else if (state.identitySource === 'restored') {
    byId('pem-status').textContent = 'not created here — JSON backup unlocked';
    byId('passphrase-status').textContent = 'entered — never displayed';
  } else {
    byId('pem-status').textContent = 'not created yet';
    byId('passphrase-status').textContent = 'not chosen yet';
  }
}

function setIdentity(seed, did, backup = null, source = 'restored') {
  state.seed = seed;
  state.did = did;
  state.backup = backup;
  state.identitySource = source;
  byId('did-value').textContent = did;
  byId('identity-empty').hidden = true;
  byId('identity-ready').hidden = false;
  byId('sign-fieldset').disabled = false;
  byId('seed-backup-fieldset').disabled = false;
  byId('current-did').value = did;
  document.body.dataset.identity = 'ready';
  updateRecordBoard();
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
    const backup = JSON.parse(await file.text());
    const restored = await decryptPortableBackup(backup, byId('restore-passphrase').value);
    const did = await createDid(restored.seed);
    const source = restored.format === 'technocore-seed-backup' ? 'seed-restored' : 'restored';
    setIdentity(restored.seed, did, backup, source);
    byId('restore-form').reset();
    announce('Identity restored in memory for this tab only.', 'success');
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
  state.signed = null;
  state.publication = null;
  state.identitySource = null;
  state.introduction = null;
  state.contribution = null;
  state.records = { lobby: null, technocore: null };
  byId('identity-empty').hidden = false;
  byId('identity-ready').hidden = true;
  byId('sign-fieldset').disabled = true;
  byId('seed-backup-fieldset').disabled = true;
  byId('seed-backup-form').reset();
  byId('signed-result').hidden = true;
  byId('publication-result').hidden = true;
  byId('current-did').value = '';
  byId('introduction-form').reset();
  byId('contribution-form').reset();
  document.body.dataset.identity = 'locked';
  updateRecordBoard();
  announce('Identity removed from this tab. Choose a different encrypted backup to unlock.', 'success');
  byId('create').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

byId('nonce').value = nextNonce();
byId('refresh-nonce').addEventListener('click', () => { byId('nonce').value = nextNonce(); });

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
  byId('result-state').textContent = 'Signed and published';
  updateRecordBoard();
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
    const signed = await signMessage(state.seed, room, byId('nonce').value, byId('message').value);
    signed.url = `${signedMessageUrl(baseUrl, room, signed.did, signed.signature, signed.nonce, signed.text)}?format=json`;
    state.signed = signed;
    byId('canonical').textContent = `${room}|${signed.nonce}|${signed.text}`;
    byId('signature').textContent = signed.signature;
    byId('request-url').value = signed.url;
    byId('signed-result').hidden = false;
    byId('result-state').textContent = 'Signed — not published';
    if (!wantsPublish) {
      announce('Message signed locally. Nothing has been published yet.', 'success');
      return;
    }
    try {
      const publication = await publishSignedMessage(signed, room, baseUrl);
      renderPublication(publication);
      byId('nonce').value = nextNonce();
      announce(`Published and verified in ${publication.room} as sequence ${publication.seq}.`, 'success');
      byId('publication-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) {
      const nonceReuse = error.message.match(/nonce [0-9]+ is not greater than ([0-9]+)/u);
      if (nonceReuse) {
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
  announce('Result URL opened in a new tab. Save the posted room, seq, ts, DID, nonce, and text from the JSON response.', 'info');
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
  byId('nonce').value = nextNonce();
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
  const messages = filterFeed(state.feedMessages, state.feedFilter);
  list.replaceChildren();
  if (!messages.length) {
    list.append(feedElement('p', 'feed-empty', `No ${state.feedFilter === 'all' ? 'activity' : `${state.feedFilter}s`} in the current window.`));
    return;
  }
  for (const message of messages) {
    const item = feedElement('article', `feed-item feed-${message.kind}`);
    item.setAttribute('aria-label', `${message.kind} in ${message.room}, sequence ${message.seq}`);
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
    const response = await fetch('/api/feed', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('feed request failed');
    const data = await response.json();
    if (!Array.isArray(data.messages) || typeof data.updatedAt !== 'string') throw new Error('invalid feed response');
    state.feedMessages = data.messages;
    renderFeed();
    byId('feed-status').textContent = data.stale ? 'Cached — upstream unavailable' : `Live — ${data.messages.length} latest entries`;
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
