import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = await mkdtemp(join(tmpdir(), 'technocore-e2e-'));
const child = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
let socketUrl;
for await (const chunk of child.stderr) {
  const match = chunk.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/u);
  if (match) { socketUrl = match[1]; break; }
}
if (!socketUrl) throw new Error('Chrome did not expose a DevTools socket.');
const ws = new WebSocket(socketUrl);
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
});
function call(method, params = {}, sessionId) {
  const callId = ++id;
  ws.send(JSON.stringify({ id: callId, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => pending.set(callId, (message) => message.error ? reject(new Error(message.error.message)) : resolve(message.result)));
}
try {
  const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);
  await call('Page.enable', {}, sessionId);
  await call('Page.navigate', { url: 'http://localhost:4173' }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const expression = `(async () => {
    const set = (selector, value) => { const el = document.querySelector(selector); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
    let initialBackupBlob;
    let initialBackupName = '';
    const initialCreateObjectURL = URL.createObjectURL;
    const initialAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob) => { initialBackupBlob = blob; return 'blob:e2e-initial-backup'; };
    HTMLAnchorElement.prototype.click = function () { initialBackupName = this.download; };
    set('#new-passphrase', 'correct horse battery staple');
    set('#confirm-passphrase', 'correct horse battery staple');
    document.querySelector('#safety-check').checked = true;
    document.querySelector('#generate-form').requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 1300));
    URL.createObjectURL = initialCreateObjectURL;
    HTMLAnchorElement.prototype.click = initialAnchorClick;
    const did = document.querySelector('#did-value').textContent;
    const initialRecordCount = document.querySelector('#record-count').textContent;
    set('#message', ' hello\\nworld ');
    set('#nonce', '1720000000000');
    document.querySelector('#sign-form').requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 500));
    const signedOnly = {
      resultVisible: !document.querySelector('#signed-result').hidden,
      canonical: document.querySelector('#canonical').textContent,
      signatureLength: document.querySelector('#signature').textContent.length,
      requestStartsCorrectly: document.querySelector('#request-url').value.startsWith('https://technocore.chat/r/lobby/say-signed/did:key:z6Mk'),
    };
    let fetchCalls = 0;
    window.fetch = async (_url, options = {}) => {
      fetchCalls += 1;
      if (String(_url).includes('/api/feed')) {
        return new Response(JSON.stringify({
          updatedAt: '2026-08-25T09:02:00Z',
          messages: [
            { room: 'technocore', kind: 'contribution', seq: 84, timestamp: '2026-08-25T09:01:00Z', from: did, text: 'Contribution: <a href="https://unsafe.example">inert link text</a>', nonce: '1720000000002' },
            { room: 'lobby', kind: 'introduction', seq: 42, timestamp: '2026-08-25T09:00:00Z', from: did, text: 'published hello', nonce: '1720000000001' },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const sent = JSON.parse(options.body);
      const seq = sent.room === 'lobby' ? 42 : 84;
      return new Response(JSON.stringify({ room: sent.room, seq, timestamp: '2026-08-25T08:00:00Z', did, nonce: sent.nonce, text: sent.text }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    let seedBackupBlob;
    let seedBackupName = '';
    const originalCreateObjectURL = URL.createObjectURL;
    const originalSeedAnchorClick = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob) => { seedBackupBlob = blob; return 'blob:e2e-seed-backup'; };
    HTMLAnchorElement.prototype.click = function () { seedBackupName = this.download; };
    const fetchesBeforeSeedBackup = fetchCalls;
    set('#seed-backup-passphrase', 'separate seed recovery passphrase');
    set('#seed-backup-confirmation', 'separate seed recovery passphrase');
    document.querySelector('#seed-backup-check').checked = true;
    document.querySelector('#seed-backup-form').requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 900));
    const seedBackupNetworkRequests = fetchCalls - fetchesBeforeSeedBackup;
    const seedBackupText = await seedBackupBlob.text();
    const seedBackupJson = JSON.parse(seedBackupText);
    URL.createObjectURL = originalCreateObjectURL;
    HTMLAnchorElement.prototype.click = originalSeedAnchorClick;

    document.querySelector('#switch-identity').click();
    const seedBackupDisabledAfterLock = document.querySelector('#seed-backup-fieldset').disabled;
    const seedBackupFile = new File([seedBackupText], seedBackupName, { type: 'application/json' });
    const transfer = new DataTransfer();
    transfer.items.add(seedBackupFile);
    document.querySelector('#backup-file').files = transfer.files;
    set('#restore-passphrase', 'separate seed recovery passphrase');
    document.querySelector('#restore-form').requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 900));
    const restoredSeedBackupDid = document.querySelector('#did-value').textContent;
    const seedBackupEnabledAfterRestore = !document.querySelector('#seed-backup-fieldset').disabled;

    set('#introduction-text', 'I build small public tools.');
    document.querySelector('#introduction-form').requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 100));
    const preparedIntroductionRoom = document.querySelector('#room').value;
    const preparedIntroductionMessage = document.querySelector('#message').value;
    set('#nonce', '1720000000001');
    document.querySelector('#publish-check').checked = true;
    document.querySelector('#sign-form').requestSubmit(document.querySelector('#sign-publish-button'));
    await new Promise(resolve => setTimeout(resolve, 500));
    const lobbyRecord = document.querySelector('#record-lobby').textContent;
    const codeOption = document.querySelector('input[name="contribution-format"][value="code"]');
    codeOption.checked = true;
    set('#contribution-url', 'https://example.com/work');
    document.querySelector('#contribution-form').requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 100));
    const preparedRoom = document.querySelector('#room').value;
    const preparedMessage = document.querySelector('#message').value;
    document.querySelector('#publish-check').checked = true;
    set('#nonce', '1720000000002');
    document.querySelector('#sign-form').requestSubmit(document.querySelector('#sign-publish-button'));
    await new Promise(resolve => setTimeout(resolve, 800));
    document.querySelector('#refresh-feed').click();
    await new Promise(resolve => setTimeout(resolve, 150));
    document.querySelector('[data-feed-filter="contribution"]').click();
    const downloads = [];
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
    document.querySelector('#download-evidence-backup-2').click();
    document.querySelector('#download-record-sheet-2').click();
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    return {
      did,
      initialBackupName,
      initialBackupFormat: initialBackupBlob ? JSON.parse(await initialBackupBlob.text()).format : '',
      initialRecordCount,
      identityReady: !document.querySelector('#identity-ready').hidden,
      recoveryBadge: document.querySelector('.no-recovery').textContent,
      signEnabled: !document.querySelector('#sign-fieldset').disabled,
      seedBackupName,
      seedBackupFormat: seedBackupJson.format,
      seedBackupDid: seedBackupJson.did,
      seedBackupHasPlainSeedField: Object.hasOwn(seedBackupJson, 'seed'),
      seedBackupContainsPassphrase: seedBackupText.includes('separate seed recovery passphrase'),
      seedBackupNetworkRequests,
      seedBackupDisabledAfterLock,
      seedBackupEnabledAfterRestore,
      restoredSeedBackupDid,
      ...signedOnly,
      publicationVisible: !document.querySelector('#publication-result').hidden,
      preparedIntroductionRoom,
      preparedIntroductionMessage,
      introductionFilterLabel: document.querySelector('[data-feed-filter="introduction"]').textContent,
      contributionFilterLabel: document.querySelector('[data-feed-filter="contribution"]').textContent,
      lobbyRecord,
      preparedRoom,
      preparedMessage,
      contributionPlaceholder: document.querySelector('#contribution-url').getAttribute('placeholder'),
      checklistPresent: Boolean(document.querySelector('.contribution-checks')),
      recordCount: document.querySelector('#record-count').textContent,
      contribution: document.querySelector('#record-contribution').textContent,
      backupLobbySequence: document.querySelector('#backup-lobby-seq').textContent,
      backupTechnocoreSequence: document.querySelector('#backup-technocore-seq').textContent,
      downloads,
      technocoreRecord: document.querySelector('#record-technocore').textContent,
      publishedRoom: document.querySelector('#published-room').textContent,
      publishedSequence: document.querySelector('#published-seq').textContent,
      publishedNonce: document.querySelector('#published-nonce').textContent,
      feedStatus: document.querySelector('#feed-status').textContent,
      feedItems: document.querySelectorAll('#feed-list .feed-item').length,
      feedText: document.querySelector('#feed-list').textContent,
      feedLinks: document.querySelectorAll('#feed-list a').length,
      contributionFilterPressed: document.querySelector('[data-feed-filter="contribution"]').getAttribute('aria-pressed'),
      workspaceMaxWidth: getComputedStyle(document.querySelector('.workspace')).maxWidth,
      firstRailLinkLeft: Math.round(document.querySelector('.rail a').getBoundingClientRect().left),
      scrollEffectsEnabled: document.documentElement.classList.contains('scroll-effects'),
      windowsCommand: document.querySelector('#cmd-windows').textContent,
      macCommand: document.querySelector('#cmd-mac').textContent,
      linuxCommand: document.querySelector('#cmd-linux').textContent,
      completeGuideLinkPresent: Boolean(document.querySelector('.read-guide')),
      topbarText: document.querySelector('.topbar').textContent.replace(/\\s+/g, ' ').trim(),
      brandPresent: Boolean(document.querySelector('.brand')),
      eyebrowPresent: Boolean(document.querySelector('.intro .eyebrow')),
      heroTitle: document.querySelector('#page-title').textContent.replace(/\\s+/g, ' ').trim(),
      heroLede: document.querySelector('.intro .lede').textContent.replace(/\\s+/g, ' ').trim(),
      heroStatement: (document.querySelector('.hero-statement')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
      heroStrongTexts: [...document.querySelectorAll('.intro strong')].map((item) => item.textContent.trim()),
      localBadgePresent: Boolean(document.querySelector('.local-badge')),
      githubHref: document.querySelector('.github-link')?.href ?? '',
      githubVisibleText: document.querySelector('.github-link')?.textContent.trim() ?? '',
      githubHasLogo: Boolean(document.querySelector('.github-link svg')),
      githubLabel: document.querySelector('.github-link')?.getAttribute('aria-label') ?? '',
      footerText: document.querySelector('body > footer').textContent.replace(/\\s+/g, ' ').trim(),
      footerJustify: getComputedStyle(document.querySelector('body > footer')).justifyContent,
      footerTextAlign: getComputedStyle(document.querySelector('body > footer')).textAlign,
      footerTextLeft: Math.round(document.querySelector('body > footer').getBoundingClientRect().left + parseFloat(getComputedStyle(document.querySelector('body > footer')).paddingLeft)),
      contributionTitle: document.querySelector('#contribution-title').textContent.trim(),
      contributionLede: document.querySelector('.contribution-lede').textContent.replace(/\\s+/g, ' ').trim(),
      contributionPrinciples: [...document.querySelectorAll('.contribution-principles > div')].map((item) => item.textContent.replace(/\\s+/g, ' ').trim()),
      contributionFormatLabels: [...document.querySelectorAll('.format-options label span')].map((item) => item.textContent.trim()),
      contributionUrlCopy: document.querySelector('label:has(#contribution-url)').textContent.replace(/\\s+/g, ' ').trim(),
      contributionCta: document.querySelector('#prepare-contribution').textContent.trim(),
      contributionFinePrint: document.querySelector('#contribution-form .fine-print').textContent.replace(/\\s+/g, ' ').trim(),
      contributionEvidenceCopy: document.querySelector('.evidence-backup').textContent.replace(/\\s+/g, ' ').trim(),
      status: document.querySelector('#status').textContent,
    };
  })()`;
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  const value = result.result.value;
  await call('Runtime.evaluate', { expression: "document.querySelector('#identity').scrollIntoView({block:'start'})" }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/record-board.png', Buffer.from(screenshot.data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 1000, deviceScaleFactor: 1, mobile: true }, sessionId);
  await call('Runtime.evaluate', { expression: "document.documentElement.style.scrollBehavior='auto'; document.querySelector('#seed-backup-form').scrollIntoView({block:'start'}); window.scrollBy(0, -110)" }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const seedBackupMobileScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/seed-backup-mobile.png', Buffer.from(seedBackupMobileScreenshot.data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);
  await call('Runtime.evaluate', { expression: "document.documentElement.style.scrollBehavior='auto'; document.querySelector('#introduction').scrollIntoView({block:'start'})" }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const introductionScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/introduction.png', Buffer.from(introductionScreenshot.data, 'base64'));
  await call('Runtime.evaluate', { expression: "document.documentElement.style.scrollBehavior='auto'; document.querySelector('#contribution').scrollIntoView({block:'start'})" }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const contributionScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/contribution.png', Buffer.from(contributionScreenshot.data, 'base64'));
  await call('Runtime.evaluate', { expression: "document.querySelector('#prepare-contribution').scrollIntoView({block:'center'})" }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const contributionBottomScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/contribution-bottom.png', Buffer.from(contributionBottomScreenshot.data, 'base64'));
  await call('Runtime.evaluate', { expression: "document.documentElement.style.scrollBehavior='auto'; document.querySelector('#live').scrollIntoView({block:'start'})" }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const feedScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/live-feed.png', Buffer.from(feedScreenshot.data, 'base64'));
  await call('Runtime.evaluate', { expression: "document.querySelector('#run').scrollIntoView({block:'start'}); document.querySelector('[data-os=windows]').click()" }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const railStateResult = await call('Runtime.evaluate', { expression: "({ activeRailHref: document.querySelector('.rail a[aria-current=step]')?.getAttribute('href') ?? '', visibleStepCount: document.querySelectorAll('.step.is-visible').length })", returnByValue: true }, sessionId);
  value.activeRailHref = railStateResult.result.value.activeRailHref;
  value.visibleStepCount = railStateResult.result.value.visibleStepCount;
  const windowsRunScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/run-windows.png', Buffer.from(windowsRunScreenshot.data, 'base64'));
  await call('Runtime.evaluate', { expression: "document.querySelector('[data-os=mac]').click()" }, sessionId);
  const macRunScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/run-macos.png', Buffer.from(macRunScreenshot.data, 'base64'));
  await call('Runtime.evaluate', { expression: "document.querySelector('[data-os=linux]').click()" }, sessionId);
  const linuxRunScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/run-linux.png', Buffer.from(linuxRunScreenshot.data, 'base64'));
  await call('Runtime.evaluate', { expression: "document.documentElement.style.scrollBehavior='auto'; window.scrollTo(0, 0)" }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const desktopHeroScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/hero-desktop.png', Buffer.from(desktopHeroScreenshot.data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
  await call('Runtime.evaluate', { expression: "window.scrollTo(0, 0)" }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const mobileHeroScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/hero-mobile.png', Buffer.from(mobileHeroScreenshot.data, 'base64'));
  await call('Runtime.evaluate', { expression: "window.scrollTo(0, document.body.scrollHeight)" }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const mobileChromeScreenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId);
  await writeFile('artifacts/nav-footer-mobile.png', Buffer.from(mobileChromeScreenshot.data, 'base64'));
  const expectedWindowsCommand = `git clone https://github.com/frianowzki/technocore-DID-studio.git
Set-Location .\\technocore-DID-studio
npm ci
npm test
npm run build
npm run serve`;
  const expectedPosixCommand = `git clone https://github.com/frianowzki/technocore-DID-studio.git
cd technocore-DID-studio
npm ci
npm test
npm run build
npm run serve`;
  const expectedHeroLede = 'Generate an encrypted did:key, move it across machines, and sign valid Technocore messages—without handing your private seed to a wallet, platform, or server.';
  const expectedHeroStatement = 'No wallet handshake. No account gate. No silent publish. Nothing goes public until you review it and say so. No airdrop bait. No borrowed trust. Just cryptography you control.';
  const expectedHeroStrongTexts = ['No middleman.', 'private seed', 'No wallet handshake. No account gate. No silent publish.', 'No airdrop bait. No borrowed trust. Just cryptography you control.'];
  const passed = value.did.startsWith('did:key:z6Mk') && value.initialRecordCount === '1 of 4' && value.identityReady && value.recoveryBadge === 'No server recovery' && value.signEnabled && value.seedBackupName.startsWith('technocore-seed-backup-') && value.seedBackupName.endsWith('.json') && value.seedBackupFormat === 'technocore-seed-backup' && value.seedBackupDid === value.did && value.seedBackupHasPlainSeedField === false && value.seedBackupContainsPassphrase === false && value.seedBackupNetworkRequests === 0 && value.seedBackupDisabledAfterLock && value.seedBackupEnabledAfterRestore && value.restoredSeedBackupDid === value.did && value.resultVisible && value.canonical === 'lobby|1720000000000|hello world' && value.signatureLength === 86 && value.requestStartsCorrectly && value.publicationVisible && value.preparedIntroductionRoom === 'lobby' && value.preparedIntroductionMessage === `Agent introduction by ${value.did}: I build small public tools.` && value.introductionFilterLabel === 'Introductions · lobby' && value.contributionFilterLabel === 'Contributions · technocore' && value.lobbyRecord === 'lobby #42' && value.preparedRoom === 'technocore' && value.preparedMessage.includes('Public contribution [code]: Code or tool') && value.preparedMessage.includes('@flop_labs') && value.preparedMessage.includes(value.did) && value.contributionPlaceholder === null && value.checklistPresent === false && value.recordCount === '4 of 4' && value.contribution === 'Code or tool: https://example.com/work' && value.backupLobbySequence === '42' && value.backupTechnocoreSequence === '84' && value.downloads.length === 2 && value.downloads[0].startsWith('technocore-public-evidence-') && value.downloads[0].endsWith('.json') && value.downloads[1].startsWith('technocore-record-sheet-') && value.downloads[1].endsWith('.txt') && value.technocoreRecord === 'technocore #84' && value.publishedRoom === 'technocore' && value.publishedSequence === '84' && value.publishedNonce === '1720000000002' && value.feedStatus === 'Live — 2 latest entries' && value.feedItems === 1 && value.feedText.includes('inert link text') && value.feedLinks === 0 && value.contributionFilterPressed === 'true' && value.workspaceMaxWidth === 'none' && value.firstRailLinkLeft <= 64 && value.scrollEffectsEnabled && value.activeRailHref === '#run' && value.visibleStepCount > 0 && value.windowsCommand === expectedWindowsCommand && value.macCommand === expectedPosixCommand && value.linuxCommand === expectedPosixCommand && value.completeGuideLinkPresent === false && value.topbarText === '' && value.brandPresent === false && value.eyebrowPresent === false && value.heroTitle === 'Your key. Your identity. No middleman.' && value.heroLede === expectedHeroLede && value.heroStatement === expectedHeroStatement && JSON.stringify(value.heroStrongTexts) === JSON.stringify(expectedHeroStrongTexts) && value.localBadgePresent === false && value.githubHref === 'https://github.com/frianowzki/technocore-DID-studio' && value.githubVisibleText === '' && value.githubHasLogo && value.githubLabel === 'View Frianowzki’s Technocore DID Studio on GitHub' && value.footerText === '© 2026 Frianowzki - Built for Technocore / Flop Labs';
  const expectedContributionPrinciples = [
    'Build the missing piece Create the guide, tool, translation, or explanation you wish had existed when you arrived.',
    'Make it worth opening Choose one format and do it with care. Clarity beats recycled hype every time.',
    'Leave a trail that lasts Keep the public HTTPS URL reachable so the signed record continues to point at real work.',
  ];
  const expectedContributionFormats = ['Teach it on video', 'Break it down on X', 'Write the deep dive', 'Map it visually', 'Translate for a new audience', 'Ship code or a tool', 'Create your own format'];
  const contentPassed = value.footerJustify === 'flex-start' && value.footerTextAlign === 'left' && value.footerTextLeft <= 64 && value.contributionTitle === 'Turn your work into proof' && value.contributionLede === 'Don’t just announce that you are here. Publish something another builder can learn from, use, or carry forward.' && JSON.stringify(value.contributionPrinciples) === JSON.stringify(expectedContributionPrinciples) && JSON.stringify(value.contributionFormatLabels) === JSON.stringify(expectedContributionFormats) && value.contributionUrlCopy === 'Where can people experience it? Paste a public HTTPS URL that opens without requesting access.' && value.contributionCta === 'Prepare contribution record →' && value.contributionFinePrint === 'This stages a public contribution for room technocore. Review it locally, then choose whether to sign only or publish.' && value.contributionEvidenceCopy.includes('Public proof kit Save the trail, not the secret') && value.contributionEvidenceCopy.includes('Download public evidence (.json)') && value.contributionEvidenceCopy.includes('Download public record (.txt)');
  const downloadIsolationPassed = value.initialBackupName.startsWith('technocore-identity-') && value.initialBackupName.endsWith('.json') && value.initialBackupFormat === 'technocore-did-studio';
  console.log(JSON.stringify(value, null, 2));
  if (!passed || !contentPassed || !downloadIsolationPassed) process.exitCode = 1;
} finally {
  ws.close();
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
