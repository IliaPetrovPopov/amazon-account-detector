// End-to-end run of the built extension in a real Chrome, against a local fake Amazon.
// Needs CHROME_PATH pointing at Chrome for Testing or Chromium.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { ACCOUNT_PAGE, EXTENSION_ORIGIN, SIGN_IN_PAGE, SITES, startHarness, waitFor } from './harness.mjs';

const PALETTE = ['#853FD8', '#0E7A9B', '#D5217E', '#006CB4', '#A85334'];

const results = [];
let h;
let popup;

async function step(name, run) {
  const started = Date.now();
  try {
    await run();
    results.push({ name, ok: true });
    console.log(`PASS  ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').join('\n      ')}`);
  }
}

// ---------- page readers ----------

const storage = (key) => h.evaluate(popup, `chrome.storage.local.get(${JSON.stringify(key)}).then((r) => r[${JSON.stringify(key)}] ?? null)`);
const record = (site) => storage(`auth:${site}`);
const recordWhere = (site, matches, what, timeoutMs = 10_000) =>
  waitFor(async () => {
    const current = await record(site);
    return current && matches(current) ? current : null;
  }, what, timeoutMs);

const popupReady = (target) =>
  waitFor(
    () =>
      h.evaluate(
        target,
        `location.protocol === 'chrome-extension:' && document.readyState === 'complete' && document.querySelectorAll('.option').length === 5`,
      ),
    'popup to load',
  );

const popupState = (target = popup) =>
  h.evaluate(
    target,
    `(() => {
      const byId = (id) => document.getElementById(id);
      const text = (id) => (byId(id).hidden ? null : byId(id).textContent);
      const combo = byId('combo');
      return {
        status: byId('status-text').textContent,
        tone: byId('status').dataset.tone,
        primary: byId('primary').textContent,
        secondary: byId('secondary').textContent,
        account: byId('account').textContent,
        avatar: byId('avatar').textContent,
        avatarColor: byId('avatar').style.getPropertyValue('--avatar-color').toUpperCase(),
        notice: byId('notice-box').hidden ? null : byId('notice').textContent,
        action: text('action'),
        freshness: text('freshness'),
        code: byId('combo-code').textContent,
        expanded: combo.getAttribute('aria-expanded'),
        activeOption: combo.getAttribute('aria-activedescendant'),
        listOpen: !byId('listbox').hidden,
        focused: document.activeElement?.id ?? null,
        alert: byId('alert').hidden ? null : byId('alert-text').textContent + ' ' + byId('alert-who').querySelector('.alert-email').textContent,
        change: byId('change').hidden ? null : byId('change').textContent,
        pinPressed: byId('pin').hidden ? null : byId('pin').getAttribute('aria-pressed'),
        pinLabel: byId('pin-label').textContent,
        copyVisible: !byId('copy').hidden,
        options: [...document.querySelectorAll('.option')].map((o) => ({
          id: o.dataset.id,
          tone: o.dataset.tone,
          selected: o.getAttribute('aria-selected'),
          account: o.querySelector('.option-account span:last-child').textContent,
          label: o.getAttribute('aria-label'),
        })),
        announce: byId('announce').textContent,
      };
    })()`,
  );

const click = (target, selector) => h.evaluate(target, `document.querySelector(${JSON.stringify(selector)}).click()`);

const KEYS = {
  ArrowDown: ['ArrowDown', 40],
  ArrowUp: ['ArrowUp', 38],
  Enter: ['Enter', 13],
  Escape: ['Escape', 27],
  Home: ['Home', 36],
  End: ['End', 35],
  Tab: ['Tab', 9],
};

/** A real key press, through Chrome's input pipeline, to whatever has focus. */
async function press(target, key) {
  const [code, keyCode] = KEYS[key] ?? [`Key${key.toUpperCase()}`, key.toUpperCase().charCodeAt(0)];
  const text = key.length === 1 ? key : key === 'Enter' ? '\r' : undefined;
  const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
  await h.browser.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) }, target.sessionId);
  await h.browser.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, target.sessionId);
  await sleep(40);
}

const badge = () =>
  h.evaluate(
    popup,
    `Promise.all([chrome.action.getBadgeText({}), chrome.action.getBadgeBackgroundColor({}), chrome.action.getTitle({})])
       .then(([text, color, title]) => ({ text, color: color.slice(0, 3).join(','), title }))`,
  );

const boardState = (target) =>
  h.evaluate(
    target,
    `(() => ({
      layout: document.body.className,
      rows: [...document.querySelectorAll('.row')].map((r) => ({
        id: r.dataset.id, account: r.dataset.account, status: r.dataset.status, tone: r.dataset.tone,
        segments: r.querySelectorAll('.segment').length,
        sub: r.querySelector('.account-sub').hidden ? null : r.querySelector('.account-sub').textContent,
        pinPressed: r.querySelector('.row-pin').getAttribute('aria-pressed'),
        pinDisabled: r.querySelector('.row-pin').disabled,
        freshness: r.querySelector('.status-sub').textContent,
        timeline: r.querySelector('.track').getAttribute('aria-label'),
      })),
      accounts: [...document.querySelectorAll('.account, .accounts-empty')].map((i) => i.textContent),
      summary: document.getElementById('summary').textContent,
      announce: document.getElementById('announce').textContent,
      checkAll: { disabled: document.getElementById('check-all').disabled, text: document.getElementById('check-all').textContent },
      tooltip: document.getElementById('tooltip').hidden ? null : document.getElementById('tooltip').textContent,
    }))()`,
  );

const rowOf = (state, id) => state.rows.find((r) => r.id === id);

async function reloadPopup() {
  await h.browser.send('Page.reload', {}, popup.sessionId);
  await sleep(250);
  await popupReady(popup);
}

/** Polls quickly while `action` runs, and reports whether anything animated on the page. */
async function sawMotion(target, action, settle) {
  let seen = false;
  let done = false;
  const watcher = (async () => {
    while (!done) {
      const running = await h.evaluate(target, `document.getAnimations().filter((a) => a.playState === 'running').length`);
      if (running > 0) seen = true;
      await sleep(25);
    }
  })();
  await action();
  await settle();
  // One last look: the change may land between two polls, and its motion outlasts the wait.
  const running = await h.evaluate(target, `document.getAnimations().filter((a) => a.playState === 'running').length`);
  if (running > 0) seen = true;
  done = true;
  await watcher;
  return seen;
}

// ---------- scenarios ----------

async function scenarios() {
  const accounts = h.amazon.state.accounts;
  accounts.set('token-alice', 'alice@example.test');
  accounts.set('token-bob', 'bob@example.test');
  accounts.set('token-carol', 'carol@example.test');

  await step('install: every marketplace reads signed out, Amazon is not contacted', async () => {
    for (const site of SITES) await recordWhere(site, (r) => r.status === 'signed_out', `${site} signed out`, 20_000);
    assert.deepEqual(h.amazon.state.requests, []);
  });

  await step('install: hourly refresh scheduled, badge shows the default marketplace', async () => {
    const alarm = await h.evaluate(popup, `chrome.alarms.get('refresh-auth')`);
    assert.equal(alarm?.periodInMinutes, 60);
    const current = await waitFor(async () => {
      const b = await badge();
      return b.text === 'US' ? b : null;
    }, 'badge US');
    assert.equal(current.color, '91,107,134');
  });

  await step('dropdown: lists every marketplace with its state, keyboard chooses one, the badge follows', async () => {
    let state = await waitFor(async () => {
      const s = await popupState();
      return s.options.every((o) => o.account === 'Signed out') ? s : null;
    }, 'options to show their state');
    assert.deepEqual(state.options.map((o) => o.id), ['com', 'co.uk', 'de', 'it', 'fr']);
    assert.equal(state.options.find((o) => o.selected === 'true')?.id, 'com');
    assert.match(state.options[2].label, /^Germany, amazon\.de, Not signed in/);
    await h.evaluate(popup, `document.getElementById('combo').focus()`);
    await press(popup, 'ArrowDown');
    state = await popupState();
    assert.equal(state.listOpen, true);
    assert.equal(state.expanded, 'true');
    assert.equal(state.activeOption, 'option-com');
    await press(popup, 'ArrowDown');
    await press(popup, 'ArrowDown');
    assert.equal((await popupState()).activeOption, 'option-de');
    await press(popup, 'Enter');
    state = await waitFor(async () => {
      const s = await popupState();
      return s.code === 'DE' ? s : null;
    }, 'combobox to show DE');
    assert.equal(state.listOpen, false);
    assert.equal(state.expanded, 'false');
    assert.equal(state.focused, 'combo', 'focus stays on the combobox');
    assert.equal(state.options.find((o) => o.selected === 'true')?.id, 'de');
    assert.equal(await storage('selectedMarketplace'), 'de');
    await waitFor(async () => (await badge()).text === 'DE', 'badge to show DE');
  });

  await step('dropdown: type to find, Escape closes without choosing, the mouse works too', async () => {
    await press(popup, 'f');
    let state = await popupState();
    assert.equal(state.listOpen, true);
    assert.equal(state.activeOption, 'option-fr');
    await press(popup, 'Escape');
    state = await popupState();
    assert.equal(state.listOpen, false);
    assert.equal(state.code, 'DE', 'Escape keeps the current marketplace');
    await click(popup, '#combo');
    assert.equal((await popupState()).listOpen, true);
    await click(popup, '#option-it');
    await waitFor(async () => (await popupState()).code === 'IT', 'click to choose Italy');
    assert.equal((await popupState()).listOpen, false);
    await sleep(800);
    await press(popup, 'd');
    await press(popup, 'Enter');
    await waitFor(async () => (await popupState()).code === 'DE', 'typeahead and Enter back to Germany');
    assert.equal(await storage('selectedMarketplace'), 'de');
  });

  await step('login: the account appears without opening any tab, with its own colour', async () => {
    const started = Date.now();
    const moved = await sawMotion(
      popup,
      () => h.setAuthCookie('de', 'token-alice'),
      () => recordWhere('de', (r) => r.email === 'alice@example.test', 'alice signed in').then(() => sleep(1200)),
    );
    assert.ok(moved, 'the change should be shown with a short transition');
    assert.deepEqual(h.pathsSince(started), [ACCOUNT_PAGE, SIGN_IN_PAGE]);
    const state = await waitFor(async () => {
      const s = await popupState();
      return s.primary === 'alice' && s.avatarColor === PALETTE[0] ? s : null;
    }, 'popup to show alice in the first colour');
    assert.equal(state.secondary, '@example.test');
    assert.equal(state.status, 'Signed in');
    assert.equal(state.tone, 'ok');
    assert.equal(state.avatar, 'A');
    assert.equal(state.account, 'amazon.de: Signed in, alice@example.test');
    assert.equal(state.announce, 'amazon.de: Signed in, alice@example.test');
    assert.equal(state.options.find((o) => o.id === 'de')?.account, 'alice');
    assert.deepEqual(await storage('accountColors'), { 'alice@example.test': 0 });
    const current = await badge();
    assert.equal(current.color, '22,163,74');
    assert.match(current.title, /amazon\.de: Signed in as alice@example\.test/);
  });

  await step('popup: reopening reuses the fresh answer and has nothing new to report', async () => {
    const started = Date.now();
    await reloadPopup();
    await sleep(1200);
    assert.deepEqual(h.pathsSince(started), []);
    const state = await popupState();
    assert.equal(state.primary, 'alice');
    assert.equal(state.change, null);
  });

  await step('account switch: the new account replaces the old one, with a colour of its own', async () => {
    await h.setAuthCookie('de', 'token-bob');
    await recordWhere('de', (r) => r.email === 'bob@example.test', 'bob signed in');
    await waitFor(async () => {
      const s = await popupState();
      return s.primary === 'bob' && s.avatarColor === PALETTE[1] ? s : null;
    }, 'popup to show bob in the second colour');
    assert.deepEqual((await storage('history:de')).map((e) => e.email), [null, 'alice@example.test', 'bob@example.test']);
    assert.deepEqual(await storage('accountColors'), { 'alice@example.test': 0, 'bob@example.test': 1 });
  });

  await step('change since last look: the popup says what changed while it was closed', async () => {
    await h.browser.send('Target.closeTarget', { targetId: popup.targetId });
    await h.setAuthCookie('de', 'token-alice');
    const control = await h.openPage(`${EXTENSION_ORIGIN}/board.html?view=panel`);
    await waitFor(
      () => h.evaluate(control, `chrome.storage.local.get('auth:de').then((r) => r['auth:de']?.email === 'alice@example.test')`),
      'alice back while the popup is closed',
    );
    await h.browser.send('Target.closeTarget', { targetId: control.targetId });
    popup = await h.openPage(`${EXTENSION_ORIGIN}/popup.html`);
    await popupReady(popup);
    const state = await waitFor(async () => {
      const s = await popupState();
      return s.change ? s : null;
    }, 'change note');
    assert.equal(state.primary, 'alice');
    assert.match(state.change, /Account changed since you last looked/);
    assert.match(state.change, /Before:.*bob@example\.test/);
    await reloadPopup();
    await sleep(400);
    assert.equal((await popupState()).change, null, 'the note shows once');
  });

  await step('copy: the email lands on the clipboard', async () => {
    await h.browser.send('Browser.grantPermissions', {
      origin: EXTENSION_ORIGIN,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    });
    await click(popup, '#copy');
    await waitFor(async () => (await popupState()).announce === 'Email copied', 'copy confirmation');
    assert.equal(await h.evaluate(popup, 'navigator.clipboard.readText()'), 'alice@example.test');
    assert.equal(await h.evaluate(popup, `document.getElementById('copy').getAttribute('aria-label')`), 'Email copied');
  });

  await step('pin: pinning the signed-in account marks it as expected', async () => {
    assert.equal((await popupState()).pinPressed, 'false');
    await click(popup, '#pin');
    await waitFor(async () => (await storage('pin:de')) === 'alice@example.test', 'pin stored');
    const state = await waitFor(async () => {
      const s = await popupState();
      return s.pinPressed === 'true' ? s : null;
    }, 'pin pressed');
    assert.equal(state.pinLabel, 'Pinned');
  });

  await step('wrong account: a different login raises the alarm everywhere', async () => {
    await h.setAuthCookie('de', 'token-bob');
    await recordWhere('de', (r) => r.email === 'bob@example.test', 'bob back');
    const state = await waitFor(async () => {
      const s = await popupState();
      return s.status === 'Wrong account' ? s : null;
    }, 'wrong account status');
    assert.equal(state.tone, 'alert');
    assert.match(state.alert, /amazon\.de is pinned to alice@example\.test/);
    assert.equal(state.action, 'Switch account');
    assert.equal(state.options.find((o) => o.id === 'de')?.tone, 'alert');
    const current = await waitFor(async () => {
      const b = await badge();
      return b.color === '220,38,38' ? b : null;
    }, 'red badge');
    assert.match(current.title, /Pinned account: alice@example\.test/);
  });

  await step('pin: "Pin this account instead" accepts the current login', async () => {
    await click(popup, '#repin');
    await waitFor(async () => (await storage('pin:de')) === 'bob@example.test', 'new pin');
    await waitFor(async () => (await popupState()).status === 'Signed in', 'alarm cleared');
    await waitFor(async () => (await badge()).color === '22,163,74', 'green badge');
  });

  await step('pin: the pin button unpins', async () => {
    await click(popup, '#pin');
    await waitFor(async () => (await storage('pin:de')) === null, 'pin removed');
    const state = await waitFor(async () => {
      const s = await popupState();
      return s.pinPressed === 'false' ? s : null;
    }, 'pin released');
    assert.equal(state.pinLabel, 'Pin account');
  });

  await step('no disruption: an open Amazon tab keeps its state and is not reloaded', async () => {
    const tab = await h.openPage('https://www.amazon.de/', { width: 1000, height: 700, scale: 1 });
    await waitFor(() => h.evaluate(tab, `document.readyState === 'complete' && !!document.getElementById('twotabsearchtextbox')`), 'storefront tab');
    await h.evaluate(tab, `window.marker = 'still here'; document.getElementById('twotabsearchtextbox').value = 'typed, not sent'`);
    const pages = async () => (await h.browser.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page').length;
    const pagesBefore = await pages();
    const storefrontLoads = h.amazon.state.requests.filter((r) => r.path === '/').length;
    const started = Date.now();
    await click(popup, '#check');
    await recordWhere('de', (r) => r.confirmedAt >= started, 'forced check');
    assert.deepEqual(await h.evaluate(tab, `[window.marker, document.getElementById('twotabsearchtextbox').value]`), ['still here', 'typed, not sent']);
    assert.equal(await pages(), pagesBefore);
    assert.equal(h.amazon.state.requests.filter((r) => r.path === '/').length, storefrontLoads);
    await h.browser.send('Target.closeTarget', { targetId: tab.targetId });
  });

  await step('offline: keeps the last answer, clearly marked as not current', async () => {
    h.amazon.state.mode = 'offline';
    await click(popup, '#check');
    const current = await recordWhere('de', (r) => r.problem === 'network', 'network problem');
    assert.equal(current.status, 'signed_in');
    assert.equal(current.email, 'bob@example.test');
    const state = await waitFor(async () => {
      const s = await popupState();
      return s.status === 'Last known' ? s : null;
    }, 'last known status');
    assert.match(state.notice, /Could not reach Amazon/);
    assert.equal(state.tone, 'warn');
    assert.equal(state.primary, 'bob', 'the account stays on screen');
    assert.match(state.freshness, /^Last confirmed/);
  });

  await step('back online: recovers on the next check, reusing the cached email', async () => {
    h.amazon.state.mode = 'normal';
    const started = Date.now();
    await click(popup, '#check');
    await recordWhere('de', (r) => r.problem === null && r.confirmedAt >= started, 'recovered');
    assert.deepEqual(h.pathsSince(started), [ACCOUNT_PAGE]);
    await waitFor(async () => (await popupState()).status === 'Signed in', 'signed in again');
  });

  await step('challenge: never read as signed out, automatic checks back off', async () => {
    h.amazon.state.mode = 'challenge';
    await click(popup, '#check');
    const current = await recordWhere('de', (r) => r.problem === 'challenge', 'challenge');
    assert.equal(current.status, 'signed_in');
    await waitFor(async () => (await popupState()).action === 'Open amazon.de', 'open site action');
    assert.match((await popupState()).notice, /browser check/);
    const started = Date.now();
    await reloadPopup();
    await sleep(1500);
    assert.deepEqual(h.pathsSince(started), [], 'opening the popup must not retry during the backoff');
    h.amazon.state.mode = 'normal';
  });

  await step('session expiry: cookie still present, Amazon says signed out', async () => {
    h.amazon.state.expired.add('token-bob');
    await click(popup, '#check');
    const current = await recordWhere('de', (r) => r.status === 'signed_out', 'signed out');
    assert.equal(current.email, null);
    const state = await waitFor(async () => {
      const s = await popupState();
      return s.primary === 'Not signed in' ? s : null;
    }, 'not signed in');
    assert.equal(state.status, 'Signed out');
    assert.equal(state.account, 'amazon.de: Not signed in');
    assert.equal(state.action, 'Sign in on amazon.de');
    assert.equal(state.copyVisible, false);
    assert.equal(state.pinPressed, null, 'nothing to pin while signed out');
    const started = Date.now();
    await reloadPopup();
    await sleep(1500);
    assert.deepEqual(h.pathsSince(started), [], 'a dead session is not refetched while the answer is fresh');
    h.amazon.state.expired.delete('token-bob');
  });

  await step('late reply: a check that finishes after logout can never write the old email', async () => {
    await h.setAuthCookie('de', 'token-carol');
    await recordWhere('de', (r) => r.email === 'carol@example.test', 'carol signed in');
    await h.evaluate(
      popup,
      `window.writes = []; chrome.storage.onChanged.addListener((changes) => {
        if (changes['auth:de']) window.writes.push(changes['auth:de'].newValue);
      })`,
    );
    h.amazon.state.delayMs = 3000;
    const started = Date.now();
    await click(popup, '#check');
    await sleep(700);
    await h.signOut('de');
    await sleep(5000);
    h.amazon.state.delayMs = 0;
    const current = await record('de');
    assert.equal(current.status, 'signed_out');
    const writes = await h.evaluate(popup, 'window.writes');
    assert.ok(writes.length > 0, 'the logout should have been written');
    assert.ok(writes.every((w) => w.status !== 'signed_in'), `got ${JSON.stringify(writes.map((w) => w.status))}`);
    assert.deepEqual(h.pathsSince(started), [ACCOUNT_PAGE]);
  });

  await step('worker restart: checks keep working after Chrome stops the service worker', async () => {
    await h.setAuthCookie('de', 'token-alice');
    await recordWhere('de', (r) => r.email === 'alice@example.test', 'alice again');
    await h.browser.send('ServiceWorker.enable', {}, popup.sessionId);
    await h.browser.send('ServiceWorker.stopAllWorkers', {}, popup.sessionId);
    await waitFor(async () => !(await h.extensionWorker()), 'service worker to stop');
    const started = Date.now();
    await click(popup, '#check');
    await recordWhere('de', (r) => r.confirmedAt >= started && r.email === 'alice@example.test', 'check after restart');
    assert.ok(await h.extensionWorker(), 'the check woke the worker');
  });

  await step('logout: the open popup updates by itself, with no request', async () => {
    const started = Date.now();
    await h.signOut('de');
    await recordWhere('de', (r) => r.status === 'signed_out', 'signed out', 6000);
    await waitFor(async () => (await popupState()).primary === 'Not signed in', 'popup to update');
    assert.equal((await popupState()).announce, 'amazon.de: Not signed in');
    assert.deepEqual(h.pathsSince(started), []);
    assert.equal((await storage('history:de')).at(-1).email, null);
  });

  await step('marketplaces are independent: a login on .co.uk leaves .de alone', async () => {
    await h.setAuthCookie('co.uk', 'token-alice');
    await recordWhere('co.uk', (r) => r.email === 'alice@example.test', 'co.uk signed in');
    assert.equal((await record('de')).status, 'signed_out');
    await waitFor(async () => (await popupState()).options.find((o) => o.id === 'co.uk')?.account === 'alice', 'dropdown to show alice on UK');
  });

  // ---------- the live board ----------

  const board = await h.openPage(`${EXTENSION_ORIGIN}/board.html`, { width: 1440, height: 900, scale: 1 });
  await waitFor(() => h.evaluate(board, `document.querySelectorAll('.row').length === 5`), 'board rows');

  await step('board: shows every marketplace, the accounts and the summary', async () => {
    const state = await waitFor(async () => {
      const s = await boardState(board);
      return rowOf(s, 'co.uk')?.account === 'alice@example.test' ? s : null;
    }, 'board to settle', 15_000);
    assert.match(state.layout, /layout-wide/);
    assert.equal(rowOf(state, 'co.uk').status, 'Signed in');
    assert.equal(rowOf(state, 'de').status, 'Signed out');
    assert.equal(rowOf(state, 'com').status, 'Signed out');
    assert.equal(rowOf(state, 'com').pinDisabled, true, 'nothing to pin while signed out');
    assert.equal(state.summary, '1 of 5 marketplaces signed in');
    assert.ok(state.accounts.some((item) => item.includes('alice@example.test') && item.includes('Signed in on UK')));
    assert.ok(state.accounts.some((item) => item.includes('carol@example.test') && item.includes('Seen in the last 24 hours')));
  });

  await step('board: the timeline shows every account change on .de, and reads as text', async () => {
    const state = await boardState(board);
    const history = await storage('history:de');
    assert.ok(history.length >= 6, `expected a rich history, got ${history.length}`);
    assert.equal(rowOf(state, 'de').segments, history.length);
    assert.match(rowOf(state, 'de').timeline, /^Last 24 hours: signed out from \d\d:\d\d to \d\d:\d\d; alice@example\.test from/);
  });

  await step('board: hovering the timeline names the account and the time', async () => {
    const point = await h.evaluate(
      board,
      `(() => {
        const track = document.querySelector('.row[data-id="co.uk"] .track').getBoundingClientRect();
        const r = [...document.querySelectorAll('.row[data-id="co.uk"] .segment')].at(-1).getBoundingClientRect();
        return { x: Math.min(r.left + r.width / 2, track.right - 1), y: track.top + track.height / 2 };
      })()`,
    );
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, board.sessionId);
    const shown = await waitFor(async () => (await boardState(board)).tooltip, 'tooltip');
    assert.match(shown, /alice@example\.test/);
    assert.match(shown, /\d\d:\d\d to now/);
    await h.browser.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 }, board.sessionId);
    await waitFor(async () => (await boardState(board)).tooltip === null, 'tooltip to hide');
  });

  await step('board: updates live when another tab signs in, highlights the row and announces it', async () => {
    const moved = await sawMotion(
      board,
      () => h.setAuthCookie('it', 'token-bob'),
      () =>
        waitFor(async () => {
          const s = await boardState(board);
          return rowOf(s, 'it').account === 'bob@example.test' ? s : null;
        }, 'it row to update', 15_000),
    );
    assert.ok(moved, 'the row should be highlighted');
    const state = await boardState(board);
    assert.equal(rowOf(state, 'it').status, 'Signed in');
    assert.equal(state.announce, 'amazon.it: Signed in, bob@example.test');
    assert.equal(state.summary, '2 of 5 marketplaces signed in');
  });

  await step('board: a pin shows on its row, and the wrong account turns the row red', async () => {
    await h.evaluate(popup, `chrome.storage.local.set({ 'pin:it': 'carol@example.test' })`);
    const state = await waitFor(async () => {
      const s = await boardState(board);
      return rowOf(s, 'it').status === 'Wrong account' ? s : null;
    }, 'wrong account row', 10_000);
    assert.equal(rowOf(state, 'it').tone, 'alert');
    assert.equal(rowOf(state, 'it').sub, 'Expected carol@example.test');
    assert.equal(rowOf(state, 'it').pinPressed, 'true');
    assert.equal(state.summary, '2 of 5 marketplaces signed in, 1 on the wrong account');
    assert.ok(state.accounts.some((item) => item.includes('carol@example.test') && item.includes('Pinned to IT')));
    await h.evaluate(popup, `chrome.storage.local.remove('pin:it')`);
    await waitFor(async () => rowOf(await boardState(board), 'it').status === 'Signed in', 'row back to normal');
  });

  await step('board: row buttons check one marketplace and pin its account', async () => {
    const started = Date.now();
    await click(board, '.row[data-id="it"] .row-check');
    await recordWhere('it', (r) => r.confirmedAt >= started, 'row check');
    assert.deepEqual([...new Set(h.requestsSince(started).map((r) => r.host))], ['www.amazon.it']);
    await click(board, '.row[data-id="it"] .row-pin');
    await waitFor(async () => (await storage('pin:it')) === 'bob@example.test', 'row pin stored');
    await waitFor(async () => rowOf(await boardState(board), 'it').sub === 'Pinned', 'row shows the pin');
    await click(board, '.row[data-id="it"] .row-pin');
    await waitFor(async () => (await storage('pin:it')) === null, 'row unpinned');
  });

  await step('board: "Check all" checks only marketplaces with a session, one by one', async () => {
    const started = Date.now();
    await click(board, '#check-all');
    await waitFor(async () => (await boardState(board)).checkAll.disabled, 'button busy');
    assert.match((await boardState(board)).checkAll.text, /^Checking \d of 5$/);
    await waitFor(async () => !(await boardState(board)).checkAll.disabled, 'check all to finish', 20_000);
    assert.equal((await boardState(board)).checkAll.text, 'Check all');
    const hosts = h.requestsSince(started).map((r) => r.host);
    assert.deepEqual([...new Set(hosts)].sort(), ['www.amazon.co.uk', 'www.amazon.it']);
    assert.ok((await record('co.uk')).confirmedAt >= started);
    assert.ok((await record('it')).confirmedAt >= started);
  });

  await step('board: adapts between wide and narrow when the window is resized', async () => {
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false }, board.sessionId);
    await waitFor(async () => /layout-narrow/.test((await boardState(board)).layout), 'narrow layout');
    const narrowOverflow = await h.evaluate(board, `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    assert.equal(narrowOverflow, 0, 'no sideways scrolling at 700 px');
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, board.sessionId);
    await waitFor(async () => /layout-wide/.test((await boardState(board)).layout), 'wide layout again');
    assert.equal(rowOf(await boardState(board), 'it').account, 'bob@example.test', 'rows keep their data');
  });

  await step('side panel: the board opens in its narrow layout', async () => {
    const panel = await h.openPage(`${EXTENSION_ORIGIN}/board.html?view=panel`, { width: 360, height: 900, scale: 1 });
    await waitFor(() => h.evaluate(panel, `document.querySelectorAll('.row').length === 5`), 'panel rows');
    const state = await waitFor(async () => {
      const s = await boardState(panel);
      return rowOf(s, 'it')?.account === 'bob@example.test' ? s : null;
    }, 'panel to settle', 15_000);
    assert.match(state.layout, /layout-narrow/);
    const overflow = await h.evaluate(panel, `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    assert.equal(overflow, 0, 'no sideways scrolling in the side panel');
    await h.browser.send('Target.closeTarget', { targetId: panel.targetId });
  });

  await step('colours: every account keeps its own colour on every surface', async () => {
    const slots = await storage('accountColors');
    assert.deepEqual(slots, { 'alice@example.test': 0, 'bob@example.test': 1, 'carol@example.test': 2 });
    const colours = await h.evaluate(
      board,
      `[...document.querySelectorAll('.account')].map((item) => [item.querySelector('.account-name').textContent, item.querySelector('.avatar').style.getPropertyValue('--avatar-color').toUpperCase()])`,
    );
    assert.deepEqual(colours, [
      ['alice@example.test', PALETTE[0]],
      ['bob@example.test', PALETTE[1]],
      ['carol@example.test', PALETTE[2]],
    ]);
    const segment = await h.evaluate(board, `document.querySelector('.row[data-id="it"] .segment:last-child').style.getPropertyValue('--segment-color').toUpperCase()`);
    assert.equal(segment, PALETTE[1], 'the timeline uses the same colour as the avatar');
  });

  await step('reduced motion: nothing animates, everything still updates', async () => {
    const calm = await h.openPage(`${EXTENSION_ORIGIN}/popup.html`, { reducedMotion: true });
    await popupReady(calm);
    await sleep(600);
    const moved = await sawMotion(
      calm,
      async () => {
        await click(calm, '#combo');
        await click(calm, '#option-co-uk');
      },
      () => waitFor(async () => (await popupState(calm)).primary === 'alice', 'popup to show alice'),
    );
    assert.equal(moved, false, 'no animation with reduced motion');
    await h.browser.send('Target.closeTarget', { targetId: calm.targetId });
  });

  await step('stress: six account switches in a second end on the right account', async () => {
    for (const [index, token] of ['s1', 's2', 's3', 's4', 's5', 's6'].entries()) accounts.set(token, `stress${index + 1}@example.test`);
    const started = Date.now();
    for (const token of ['s1', 's2', 's3', 's4', 's5', 's6']) {
      await h.setAuthCookie('fr', token);
      await sleep(150);
    }
    await recordWhere('fr', (r) => r.email === 'stress6@example.test', 'last account', 15_000);
    await sleep(2500);
    assert.equal((await record('fr')).email, 'stress6@example.test');
    const homepageChecks = h.requestsSince(started).filter((r) => r.host === 'www.amazon.fr' && r.path === ACCOUNT_PAGE).length;
    assert.ok(homepageChecks <= 2, `settling should collapse the burst, saw ${homepageChecks} checks`);
    assert.equal((await storage('history:fr')).at(-1).email, 'stress6@example.test');
    assert.equal(rowOf(await boardState(board), 'fr').account, 'stress6@example.test');
    const slots = await storage('accountColors');
    assert.equal(slots['alice@example.test'], 0, 'earlier accounts keep their colours');
    assert.ok([3, 4].includes(slots['stress6@example.test']), `the next new account takes a free colour, got ${slots['stress6@example.test']}`);
  });

  await step('stress: hammering "Check now" runs one check at a time', async () => {
    h.amazon.state.delayMs = 800;
    const started = Date.now();
    await click(popup, '#combo');
    await click(popup, '#option-co-uk');
    await sleep(300);
    await h.evaluate(popup, `for (let i = 0; i < 10; i += 1) document.getElementById('check').click()`);
    await sleep(3000);
    h.amazon.state.delayMs = 0;
    const checks = h.requestsSince(started).filter((r) => r.host === 'www.amazon.co.uk' && r.path === ACCOUNT_PAGE).length;
    assert.ok(checks <= 2, `expected at most 2 account page requests, saw ${checks}`);
  });

  await step('long and unusual account names never break the layout', async () => {
    const long = 'alexandra.konstantinopoulou-papadimitriou@subdomain.example-company.co.uk';
    accounts.set('token-long', long);
    accounts.set('token-phone', '+44 7700 900123');
    await h.setAuthCookie('it', 'token-long');
    await h.setAuthCookie('de', 'token-phone');
    await recordWhere('it', (r) => r.email === long, 'long email signed in', 15_000);
    await recordWhere('de', (r) => r.email === '+44 7700 900123', 'phone account signed in', 15_000);
    const overflow = (target) => h.evaluate(target, `document.documentElement.scrollWidth - document.documentElement.clientWidth`);

    await click(popup, '#combo');
    assert.equal(await overflow(popup), 0, 'the open dropdown fits');
    await click(popup, '#option-it');
    await waitFor(async () => (await popupState()).primary === 'alexandra.konstantinopoulou-papadimitriou', 'popup to show the long email');
    assert.equal(await overflow(popup), 0, 'the long email wraps inside the popup');
    await click(popup, '#combo');
    await click(popup, '#option-de');
    const phone = await waitFor(async () => {
      const s = await popupState();
      return s.primary === '+44 7700 900123' ? s : null;
    }, 'popup to show the phone account');
    assert.equal(phone.avatar, '', 'no letters to show: the avatar draws a person');
    assert.equal(phone.secondary, 'amazon.de');
    assert.equal(await h.evaluate(popup, `!!document.querySelector('#avatar svg')`), true);

    await waitFor(async () => rowOf(await boardState(board), 'it').account === long, 'board to show the long email');
    assert.equal(await overflow(board), 0, 'wide board');
    assert.equal(await h.evaluate(board, `document.querySelector('.row[data-id="it"] .account-email').title`), long);
    await h.browser.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 1, mobile: false }, board.sessionId);
    await waitFor(async () => /layout-narrow/.test((await boardState(board)).layout), 'narrow layout');
    assert.equal(await overflow(board), 0, 'narrow board');
  });

  await step('no uncaught errors in any extension page or the service worker', async () => {
    await sleep(500);
    assert.deepEqual(h.errors, []);
  });
}

// ---------- main ----------

try {
  h = await startHarness();
  popup = await h.openPage(`${EXTENSION_ORIGIN}/popup.html`);
  await popupReady(popup);
  await scenarios();
} catch (error) {
  results.push({ name: 'setup', ok: false });
  console.error(`Run stopped: ${error.stack ?? error.message}`);
} finally {
  await h?.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
