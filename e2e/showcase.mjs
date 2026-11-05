// Renders the README images from the real extension against the fake Amazon:
// the live board in light and dark, and the popup in its main states.
// Usage: CHROME_PATH=... npm run showcase   (SHOWCASE_OUT=some/dir to write elsewhere)
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { EXTENSION_ORIGIN, startHarness, waitFor } from './harness.mjs';

const OUT = process.env.SHOWCASE_OUT ?? 'docs';
const HOUR = 3_600_000;

const h = await startHarness();
try {
  await mkdir(OUT, { recursive: true });
  const control = await h.openPage(`${EXTENSION_ORIGIN}/popup.html`);
  await waitFor(() => h.evaluate(control, `document.querySelectorAll('.option').length === 5`), 'popup');
  const read = (key) => h.evaluate(control, `chrome.storage.local.get('${key}').then((r) => r['${key}'] ?? null)`);
  const until = (key, matches, what) => waitFor(async () => matches(await read(key)), what, 15_000);

  // The scene: every state the board can show.
  const accounts = h.amazon.state.accounts;
  accounts.set('alice', 'alice.lindqvist@example.com');
  accounts.set('bob', 'bob.marchetti@example.com');
  accounts.set('carol', 'carol.dupont@example.com');
  await until('auth:com', (r) => r?.status === 'signed_out', 'install refresh');

  for (const [site, token] of [['co.uk', 'alice'], ['de', 'bob'], ['it', 'alice'], ['fr', 'carol']]) {
    await h.setAuthCookie(site, token);
    await until(`auth:${site}`, (r) => r?.status === 'signed_in', `${site} signed in`);
  }

  // France: Amazon starts asking for a browser check, so the board keeps the last known answer.
  h.amazon.state.challengeHosts.add('www.amazon.fr');
  await h.evaluate(control, `chrome.runtime.sendMessage({ type: 'check', marketplace: 'fr', force: true })`);
  await until('auth:fr', (r) => r?.problem === 'challenge', 'fr challenge');

  // Germany is pinned to Alice, but Bob is signed in. A day of history fills the timelines.
  const now = Date.now();
  const alice = 'alice.lindqvist@example.com';
  const bob = 'bob.marchetti@example.com';
  const carol = 'carol.dupont@example.com';
  await h.evaluate(
    control,
    `chrome.storage.local.set(${JSON.stringify({
      'pin:de': alice,
      'pin:co.uk': alice,
      selectedMarketplace: 'co.uk',
      'history:com': [
        { at: now - 22 * HOUR, email: alice },
        { at: now - 15 * HOUR, email: null },
        { at: now - 9 * HOUR, email: bob },
        { at: now - 5 * HOUR, email: null },
      ],
      'history:co.uk': [
        { at: now - 20 * HOUR, email: alice },
        { at: now - 12 * HOUR, email: null },
        { at: now - 10 * HOUR, email: alice },
      ],
      'history:de': [
        { at: now - 23 * HOUR, email: alice },
        { at: now - 16 * HOUR, email: bob },
        { at: now - 11 * HOUR, email: alice },
        { at: now - 4 * HOUR, email: null },
        { at: now - 1.5 * HOUR, email: bob },
      ],
      'history:it': [
        { at: now - 18 * HOUR, email: carol },
        { at: now - 8 * HOUR, email: alice },
      ],
      'history:fr': [
        { at: now - 21 * HOUR, email: null },
        { at: now - 14 * HOUR, email: carol },
      ],
    })})`,
  );
  await until('accountColors', (slots) => slots && Object.keys(slots).length === 3, 'account colours');
  await sleep(300);

  const shot = async (target, file, clip) => {
    const { data } = await h.browser.send(
      'Page.captureScreenshot',
      { format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}) },
      target.sessionId,
    );
    await writeFile(`${OUT}/${file}`, Buffer.from(data, 'base64'));
  };
  const boardSettled = (target) =>
    waitFor(
      () => h.evaluate(target, `document.querySelector('.row[data-id="de"]')?.dataset.status === 'Wrong account' && document.querySelectorAll('.account').length === 3`),
      'board to settle',
      20_000,
    );

  // The board, wide, in light and dark.
  for (const [file, dark] of [['board.png', false], ['board-dark.png', true]]) {
    const board = await h.openPage(`${EXTENSION_ORIGIN}/board.html`, { width: 1440, height: 960, scale: 1, dark });
    await boardSettled(board);
    await sleep(400);
    const bottom = await h.evaluate(board, `Math.ceil(document.querySelector('.page').getBoundingClientRect().bottom)`);
    await shot(board, file, { x: 0, y: 0, width: 1440, height: bottom, scale: 1 });
    await h.browser.send('Target.closeTarget', { targetId: board.targetId });
  }

  // The popup in its main states.
  const popupShot = async (file, dark, marketplace, prepare) => {
    await h.evaluate(control, `chrome.storage.local.set({ selectedMarketplace: '${marketplace}' })`);
    const popup = await h.openPage(`${EXTENSION_ORIGIN}/popup.html`, { width: 360, height: 640, scale: 2, dark });
    await waitFor(() => h.evaluate(popup, `document.querySelectorAll('.option').length === 5`), 'popup');
    await sleep(900);
    if (prepare) await prepare(popup);
    const height = await h.evaluate(
      popup,
      `Math.ceil(Math.max(document.body.getBoundingClientRect().height, document.getElementById('listbox').hidden ? 0 : document.getElementById('listbox').getBoundingClientRect().bottom + 16))`,
    );
    await shot(popup, file, { x: 0, y: 0, width: 360, height, scale: 1 });
    await h.browser.send('Target.closeTarget', { targetId: popup.targetId });
  };
  await popupShot('popup-light.png', false, 'co.uk');
  await popupShot('popup-alert.png', true, 'de');
  await popupShot('popup-menu.png', false, 'co.uk', async (popup) => {
    await h.evaluate(popup, `document.getElementById('combo').focus(); document.getElementById('combo').click()`);
    await h.evaluate(popup, `document.getElementById('combo').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
    await sleep(300);
  });

  console.log(`Images written to ${OUT}/`);
} finally {
  await h.close();
}
