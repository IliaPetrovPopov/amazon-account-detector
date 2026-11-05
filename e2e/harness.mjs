// Shared setup for the end-to-end run and the screenshots: the built extension in a headless
// Chrome for Testing, a local fake Amazon, and small DevTools Protocol helpers.
// Chrome's host rules send the five Amazon hostnames to the fake server and every other
// hostname nowhere, so nothing can reach the real internet.
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectCdp } from './cdp.mjs';
import { AUTH_COOKIES, startFakeAmazon } from './fake-amazon.mjs';

export const DIST = resolve('dist');
// Chrome names an unpacked extension after its folder path. Chrome for Testing also runs
// built-in extensions with their own service workers, so the id tells ours apart.
export const EXTENSION_ID = [...createHash('sha256').update(DIST).digest('hex').slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

export const SITES = ['com', 'co.uk', 'de', 'it', 'fr'];
export const ACCOUNT_PAGE = '/gp/css/homepage.html';
export const SIGN_IN_PAGE = '/ap/signin';

const hostOf = (site) => `www.amazon.${site}`;

function makeCertificate(work) {
  const keyPath = join(work, 'key.pem');
  const certPath = join(work, 'cert.pem');
  const names = Object.keys(AUTH_COOKIES).map((host) => `DNS:${host}`).join(',');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=fake-amazon.test',
      '-addext', `subjectAltName=${names}`, '-keyout', keyPath, '-out', certPath],
    { stdio: 'ignore' },
  );
  return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
}

function launchChrome(chromePath, profile, port) {
  const rules = [
    ...Object.keys(AUTH_COOKIES).map((host) => `MAP ${host} 127.0.0.1:${port}`),
    'EXCLUDE 127.0.0.1',
    'MAP * ~NOTFOUND',
  ].join(',');
  const child = spawn(
    chromePath,
    [
      '--headless=new',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      `--host-resolver-rules=${rules}`,
      '--ignore-certificate-errors',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-default-apps',
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  child.on('error', (error) => console.error(`Chrome failed to start: ${error.message}`));
  return child;
}

async function devToolsUrl(profile) {
  const file = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const [port, path] = (await readFile(file, 'utf8')).trim().split('\n');
      if (port && path) return `ws://127.0.0.1:${port}${path}`;
    } catch {
      // Not written yet.
    }
    await sleep(100);
  }
  throw new Error('Chrome did not open its DevTools port');
}

export async function waitFor(probe, what, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

export async function startHarness() {
  const chromePath = process.env.CHROME_PATH;
  if (!chromePath) {
    throw new Error('Set CHROME_PATH to Chrome for Testing or Chromium. Branded Chrome ignores --load-extension.');
  }
  const work = await mkdtemp(join(tmpdir(), 'amazon-detector-e2e-'));
  const profile = join(work, 'profile');
  const amazon = await startFakeAmazon(makeCertificate(work));
  const chrome = launchChrome(chromePath, profile, amazon.port);
  const browser = await connectCdp(await devToolsUrl(profile));

  // Collect uncaught errors from every extension context, service worker included.
  const errors = [];
  const watched = new Set();
  const watch = async (info) => {
    if (!info.url.startsWith(`${EXTENSION_ORIGIN}/`) || watched.has(info.targetId)) return;
    watched.add(info.targetId);
    try {
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId: info.targetId, flatten: true });
      await browser.send('Runtime.enable', {}, sessionId);
    } catch {
      // Short-lived targets, such as the offscreen document, may be gone already.
    }
  };
  browser.on('Target.targetCreated', ({ targetInfo }) => void watch(targetInfo));
  browser.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text);
  });
  browser.on('Runtime.consoleAPICalled', ({ type, args }) => {
    if (type === 'error') errors.push(args.map((a) => a.value ?? a.description ?? '').join(' '));
  });
  await browser.send('Target.setDiscoverTargets', { discover: true });

  const extensionWorker = async () => {
    const { targetInfos } = await browser.send('Target.getTargets');
    return targetInfos.find((t) => t.type === 'service_worker' && t.url === `${EXTENSION_ORIGIN}/background.js`);
  };
  await waitFor(extensionWorker, 'extension service worker');

  async function openPage(url, { width = 360, height = 640, scale = 2, dark = false, reducedMotion = false } = {}) {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.send('Runtime.enable', {}, sessionId);
    await browser.send('Page.enable', {}, sessionId);
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, sessionId);
    await browser.send(
      'Emulation.setEmulatedMedia',
      {
        features: [
          { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' },
          { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
        ],
      },
      sessionId,
    );
    await browser.send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
    await browser.send('Page.navigate', { url }, sessionId);
    return { targetId, sessionId };
  }

  async function evaluate(target, expression) {
    const { result, exceptionDetails } = await browser.send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      target.sessionId,
    );
    if (exceptionDetails) {
      throw new Error(`Page script failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    }
    return result.value;
  }

  async function setAuthCookie(site, value) {
    await browser.send('Storage.setCookies', {
      cookies: [
        {
          name: AUTH_COOKIES[hostOf(site)],
          value,
          domain: `.amazon.${site}`,
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'Lax',
          expires: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
    });
  }

  /** Like Amazon's sign-out: the cookie is overwritten by one that has already expired. */
  async function signOut(site) {
    const name = AUTH_COOKIES[hostOf(site)];
    await browser.send('Storage.setCookies', {
      cookies: [
        { name, value: '', domain: `.amazon.${site}`, path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: 1 },
      ],
    });
    const { cookies } = await browser.send('Storage.getCookies');
    if (cookies.some((c) => c.name === name)) throw new Error(`${name} should be gone`);
  }

  async function close() {
    browser.close();
    if (chrome.exitCode === null) {
      const exited = new Promise((done) => chrome.once('exit', done));
      chrome.kill();
      await Promise.race([exited, sleep(5000)]);
    }
    await amazon.close();
    await rm(work, { recursive: true, force: true, maxRetries: 3 });
  }

  return {
    browser,
    amazon,
    errors,
    extensionWorker,
    openPage,
    evaluate,
    setAuthCookie,
    signOut,
    pathsSince: (at) => amazon.requestsSince(at).map((r) => r.path),
    requestsSince: (at) => amazon.requestsSince(at),
    close,
  };
}
