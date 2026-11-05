import { refreshBadge } from './badge';
import { checkMarketplace, type CheckDeps } from './check';
import { accountsInOrder, assignColors, sameColors } from './identity';
import type { CheckRequest } from './messages';
import { MARKETPLACES, MARKETPLACE_IDS, homeUrl, isMarketplaceId, type Marketplace } from './marketplaces';
import { extractEmailOffscreen } from './offscreen-client';
import { omniboxSuggestions } from './omnibox';
import { createAuthService } from './service';
import { sessionSignal } from './session-signal';
import { authStore, colorStore, historyStore, pinStore, touchesAccounts, touchesAuthState } from './store';
import type { PageResponse } from './types';
import { boardRow } from './view';

const REFRESH_ALARM = 'refresh-auth';
const REFRESH_EVERY_MINUTES = 60;

async function fetchPage(url: string): Promise<PageResponse> {
  const response = await fetch(url, {
    // Amazon is cross-origin from the extension, so the default would send no cookies.
    credentials: 'include',
    cache: 'no-store',
    headers: { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(20_000),
  });
  return {
    status: response.status,
    finalUrl: response.url,
    wafAction: response.headers.get('x-amzn-waf-action'),
    html: await response.text(),
  };
}

async function readAuthCookie(m: Marketplace): Promise<string | null> {
  const cookie = await chrome.cookies.get({ url: `https://www.${m.domain}/`, name: m.authCookie });
  return cookie?.value || null;
}

/** Only a short one-way hash is stored, so the cookie itself never reaches extension storage. */
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const checkDeps: CheckDeps = {
  readAuthCookie,
  fetchPage,
  extractEmail: extractEmailOffscreen,
  hash,
  now: () => Date.now(),
};

let colorsDone: Promise<void> = Promise.resolve();

/**
 * Gives every account in sight a colour of its own, in the order the accounts appeared.
 * Runs one at a time, so two updates can never hand out colours from the same stale read.
 */
function syncColors(): Promise<void> {
  colorsDone = colorsDone
    .then(async () => {
      const [records, pins, history, slots] = await Promise.all([
        authStore.getAll(),
        pinStore.getAll(),
        historyStore.getAll(),
        colorStore.get(),
      ]);
      const current = MARKETPLACE_IDS.flatMap((id) => [
        records[id].status === 'signed_in' ? records[id].email : null,
        pins[id],
      ]);
      const next = assignColors(slots, accountsInOrder(MARKETPLACE_IDS.flatMap((id) => history[id]), current));
      if (!sameColors(slots, next)) await colorStore.set(next);
    })
    .catch((error) => console.warn('Colour update failed', error));
  return colorsDone;
}

const service = createAuthService({
  store: authStore,
  check: (m, previous, options) => checkMarketplace(m, previous, options, checkDeps),
  onStored: async (id, record) => {
    await historyStore.record(id, record, Date.now());
    await syncColors();
  },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** One site at a time with some jitter. Sites with no auth cookie cost no network at all. */
async function refreshAll(): Promise<void> {
  for (const id of MARKETPLACE_IDS) {
    await service.request(id).catch((error) => console.warn('Refresh failed', id, error));
    await sleep(500 + Math.random() * 1500);
  }
}

const updateBadge = () => refreshBadge().catch((error) => console.warn('Badge update failed', error));

async function startup(): Promise<void> {
  // Chrome may clear alarms when the browser restarts.
  const existing = await chrome.alarms.get(REFRESH_ALARM);
  if (!existing) await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_EVERY_MINUTES });
  await updateBadge();
  await syncColors();
  await refreshAll();
}

// Listeners register at the top level so Chrome can wake this worker for them.
chrome.runtime.onInstalled.addListener(() => void startup());
chrome.runtime.onStartup.addListener(() => void startup());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REFRESH_ALARM) return;
  // The badge also turns "last known" by age alone, even when no record changes.
  void refreshAll().then(updateBadge);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const keys = Object.keys(changes);
  if (touchesAuthState(keys)) void updateBadge();
  if (touchesAccounts(keys)) void syncColors();
});

// Address bar: type "amz", a space, and optionally a filter such as "de" or part of an email.
chrome.omnibox.setDefaultSuggestion({ description: 'Show which Amazon account is signed in on each marketplace' });

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  void Promise.all([authStore.getAll(), pinStore.getAll()]).then(([records, pins]) => {
    const now = Date.now();
    const rows = MARKETPLACE_IDS.map((id) => boardRow(records[id], MARKETPLACES[id], now, pins[id]));
    suggest(omniboxSuggestions(rows, text));
  });
});

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  const marketplace = MARKETPLACE_IDS.map((id) => MARKETPLACES[id]).find((m) => m.domain === text.trim());
  const url = marketplace ? homeUrl(marketplace) : chrome.runtime.getURL('board.html');
  if (disposition === 'currentTab') void chrome.tabs.update({ url });
  else void chrome.tabs.create({ url, active: disposition === 'newForegroundTab' });
});

chrome.cookies.onChanged.addListener((change) => {
  const id = sessionSignal(change);
  if (id) service.onSessionSignal(id);
});

chrome.runtime.onMessage.addListener((message: CheckRequest, _sender, sendResponse) => {
  if (message?.type !== 'check' || !isMarketplaceId(message.marketplace)) return false;
  service
    .request(message.marketplace, { force: message.force })
    .then(sendResponse)
    .catch((error) => {
      console.warn('Check failed', message.marketplace, error);
      sendResponse(null);
    });
  return true;
});
