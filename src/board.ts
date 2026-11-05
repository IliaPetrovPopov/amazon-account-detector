import { avatar, byId, el, icon, paintAvatar, prefersReducedMotion, settleIn } from './dom';
import { timelineSegments, type TimelineSegment } from './history';
import { accountColor, accountKey, type ColorSlots } from './identity';
import type { CheckRequest } from './messages';
import { MARKETPLACE_IDS, MARKETPLACES, type MarketplaceId } from './marketplaces';
import { authStore, colorStore, historyStore, pinStore, touchesAuthState } from './store';
import { EMPTY_RECORD, type AuthRecord, type HistoryEvent } from './types';
import { boardRow, boardSummary, clockTime, type BoardRowView } from './view';

// The live board: every marketplace at once, in a tab or in Chrome's side panel. It updates as soon
// as the service worker stores a new answer, for example after a sign-out in another tab.

const NARROW_BELOW_PX = 900;
const RELABEL_EVERY_MS = 30_000;
const DAY = 24 * 3_600_000;

type Layout = 'wide' | 'narrow';
type Reason = 'initial' | 'live' | 'tick';

interface Row {
  element: HTMLLIElement;
  account: HTMLElement;
  avatar: HTMLElement;
  email: HTMLElement;
  sub: HTMLElement;
  pill: HTMLElement;
  pillText: HTMLElement;
  freshness: HTMLElement;
  track: HTMLElement;
  check: HTMLButtonElement;
  pin: HTMLButtonElement;
  segments: TimelineSegment[];
  view?: BoardRowView;
}

const rowsHost = byId('rows');
const axis = byId('axis');
const accountsHost = byId('accounts');
const summary = byId('summary');
const checkAllButton = byId<HTMLButtonElement>('check-all');
const checkAllLabel = byId('check-all-label');
const tooltip = byId('tooltip');
const announce = byId('announce');

const rows = new Map<MarketplaceId, Row>();
const checking = new Set<MarketplaceId>();

let layout: Layout = 'wide';
let records = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, EMPTY_RECORD])) as Record<MarketplaceId, AuthRecord>;
let pins = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, null])) as Record<MarketplaceId, string | null>;
let history = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, [] as HistoryEvent[]])) as Record<
  MarketplaceId,
  HistoryEvent[]
>;
let colors: ColorSlots = {};

const colorOf = (email: string | null) => (email ? accountColor(colors, email) : null);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** "UK", "UK and IT", "UK, DE and IT". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** A clock time, marked as yesterday when it was. */
function when(ms: number, now: number): string {
  const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
  return sameDay ? clockTime(ms) : `yesterday ${clockTime(ms)}`;
}

/** "09:12 to 13:40", or "09:12 to now" for the part that is still going on. */
function span(segment: TimelineSegment, ongoing: boolean, now: number): string {
  return `${when(segment.from, now)} to ${ongoing ? 'now' : when(segment.to, now)}`;
}

function layoutFor(width: number): Layout {
  if (new URLSearchParams(location.search).get('view') === 'panel') return 'narrow';
  return width < NARROW_BELOW_PX ? 'narrow' : 'wide';
}

function applyLayout(next: Layout): void {
  layout = next;
  document.body.classList.toggle('layout-wide', layout === 'wide');
  document.body.classList.toggle('layout-narrow', layout === 'narrow');
}

// ---------- Building ----------

function buildRows(): void {
  for (const id of MARKETPLACE_IDS) {
    const m = MARKETPLACES[id];
    const element = el('li', 'row');
    element.dataset.id = id;

    const code = el('span', 'code', m.code);
    code.setAttribute('aria-hidden', 'true');
    const marketText = el('span', 'market-text');
    marketText.append(el('span', 'market-name', m.label), el('span', 'market-domain', m.domain));
    const market = el('div', 'cell-market');
    market.append(code, marketText);

    const rowAvatar = avatar(null, null);
    const email = el('span', 'account-email');
    const sub = el('span', 'account-sub');
    const accountText = el('span', 'account-text');
    accountText.append(email, sub);
    const account = el('div', 'cell-account');
    account.append(rowAvatar, accountText);

    const pill = el('span', 'pill');
    const dot = el('span', 'dot');
    dot.setAttribute('aria-hidden', 'true');
    const pillText = el('span');
    pill.append(dot, pillText);
    const freshness = el('span', 'status-sub');
    const status = el('div', 'cell-status');
    status.append(pill, freshness);

    const track = el('div', 'track');
    track.setAttribute('role', 'img');
    const timeline = el('div', 'cell-timeline');
    timeline.append(track);

    const check = el('button', 'icon-button row-check');
    check.type = 'button';
    check.append(icon('refresh'));
    check.setAttribute('aria-label', `Check ${m.domain} now`);
    check.title = `Check ${m.domain} now`;
    const pin = el('button', 'icon-button row-pin');
    pin.type = 'button';
    pin.append(icon('pin'));
    pin.setAttribute('aria-label', `Pin the account on ${m.domain}`);
    const actions = el('div', 'cell-actions');
    actions.append(check, pin);

    element.append(market, account, status, timeline, actions);
    rowsHost.append(element);

    const row: Row = { element, account, avatar: rowAvatar, email, sub, pill, pillText, freshness, track, check, pin, segments: [] };
    rows.set(id, row);

    check.addEventListener('click', () => void requestCheck(id));
    pin.addEventListener('click', () => {
      const record = records[id];
      if (pins[id]) void pinStore.set(id, null);
      else if (record.status === 'signed_in' && record.email) void pinStore.set(id, record.email);
    });
    timeline.addEventListener('pointermove', (event) => showTooltip(row, event));
    timeline.addEventListener('pointerleave', () => hideTooltip(row));
  }
}

function buildAxis(): void {
  const labels: Array<[number, string]> = [
    [0, '24 h'],
    [25, '18 h'],
    [50, '12 h'],
    [75, '6 h'],
    [100, 'Now'],
  ];
  axis.replaceChildren(
    ...labels.map(([percent, text]) => {
      const label = el('span', '', text);
      label.style.left = `${percent}%`;
      return label;
    }),
  );
}

// ---------- Timeline ----------

function renderTimeline(row: Row, events: HistoryEvent[], now: number): void {
  row.segments = timelineSegments(events, now);
  row.track.replaceChildren(
    ...row.segments.map((segment) => {
      const part = el('span', segment.email ? 'segment' : 'segment out');
      // Under a few pixels a hatch reads as a stray slash, so short marks get a flat fill.
      part.classList.toggle('is-short', (segment.end - segment.start) * row.track.clientWidth < 6);
      // A short session still gets a visible mark, kept inside the bar at the "now" end.
      part.style.left = `min(${segment.start * 100}%, calc(100% - 3px))`;
      part.style.width = `${(segment.end - segment.start) * 100}%`;
      const color = colorOf(segment.email);
      if (color) part.style.setProperty('--segment-color', color);
      return part;
    }),
  );
  const spans = row.segments.map(
    (segment, index) => `${segment.email ?? 'signed out'} from ${span(segment, index === row.segments.length - 1, now)}`,
  );
  row.track.setAttribute('aria-label', spans.length ? `Last 24 hours: ${spans.join('; ')}` : 'No record in the last 24 hours');
}

function showTooltip(row: Row, event: PointerEvent): void {
  // Hit-test what is drawn, not the time it stands for: a short session still gets a 3 px mark.
  const parts = [...row.track.children];
  let index = -1;
  let nearest = 4;
  parts.forEach((part, i) => {
    const box = part.getBoundingClientRect();
    const distance = event.clientX < box.left ? box.left - event.clientX : Math.max(0, event.clientX - box.right);
    // Later marks are drawn on top, so they win a tie.
    if (distance <= nearest) {
      nearest = distance;
      index = i;
    }
  });
  const segment = row.segments[index];
  row.track.classList.toggle('is-hovering', Boolean(segment));
  parts.forEach((part, i) => part.classList.toggle('is-hover', i === index));
  if (!segment) {
    tooltip.hidden = true;
    return;
  }
  const now = Date.now();
  const who = el('div', 'tooltip-who');
  if (segment.email) who.append(avatar(segment.email, colorOf(segment.email)), el('span', '', segment.email));
  else who.append('Signed out');
  tooltip.replaceChildren(who, el('div', 'tooltip-when', span(segment, index === row.segments.length - 1, now)));
  tooltip.hidden = false;

  const rect = row.track.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const x = Math.min(Math.max(event.clientX - tip.width / 2, 8), window.innerWidth - tip.width - 8);
  const above = rect.top - tip.height - 10;
  const y = above >= 8 ? above : rect.bottom + 10;
  tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

function hideTooltip(row: Row): void {
  tooltip.hidden = true;
  row.track.classList.remove('is-hovering');
}

// ---------- Rendering ----------

/** A soft highlight that fades out, on a row that just changed. */
function flash(element: HTMLElement): void {
  if (prefersReducedMotion()) return;
  element.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: 1800,
    easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    pseudoElement: '::before',
  });
}

function accountLine(view: BoardRowView, record: AuthRecord): string {
  if (view.account) return view.account;
  if (record.status === 'signed_in') return 'Email not shown';
  if (record.status === 'signed_out') return 'Not signed in';
  return record.problem ? 'No answer yet' : 'Not checked yet';
}

function renderRow(id: MarketplaceId, row: Row, now: number, reason: Reason): void {
  const record = records[id];
  const settled = boardRow(record, MARKETPLACES[id], now, pins[id]);
  const isChecking = checking.has(id);
  const view: BoardRowView = isChecking ? { ...settled, freshness: 'Checking…' } : settled;
  const previous = row.view;
  row.view = view;

  row.element.dataset.tone = view.tone;
  row.element.dataset.status = view.status;
  row.element.dataset.account = view.account;
  row.element.classList.toggle('is-off', !view.account);
  row.element.classList.toggle('is-dim', view.dim);

  paintAvatar(row.avatar, view.account || null, colorOf(view.account || null));
  row.email.textContent = accountLine(view, record);
  row.email.title = view.account;

  row.sub.replaceChildren();
  if (view.pinState === 'mismatch' && view.pin) row.sub.append(icon('pin'), el('span', '', `Expected ${view.pin}`));
  else if (view.pinState === 'match') row.sub.append(icon('pin'), el('span', '', 'Pinned'));
  row.sub.hidden = row.sub.childElementCount === 0;
  row.sub.title = row.sub.textContent ?? '';

  row.pill.dataset.tone = view.tone;
  row.pillText.textContent = view.status;
  row.freshness.textContent = view.freshness;

  row.check.disabled = isChecking;
  row.check.querySelector('.icon')?.classList.toggle('spin', isChecking);

  const signedInEmail = record.status === 'signed_in' ? record.email : null;
  row.pin.disabled = !pins[id] && !signedInEmail;
  row.pin.setAttribute('aria-pressed', String(Boolean(pins[id])));
  row.pin.title = pins[id]
    ? `Pinned to ${pins[id]}. Click to unpin.`
    : signedInEmail
      ? `Expect ${signedInEmail} on ${view.domain}`
      : 'Sign in to pin an account';

  renderTimeline(row, history[id], now);

  const changed = previous !== undefined && (previous.status !== view.status || previous.account !== view.account);
  if (reason === 'live' && changed) {
    flash(row.element);
    settleIn(row.account);
    announce.textContent = `${view.domain}: ${view.status}${view.account ? `, ${view.account}` : ''}`;
  }
}

function renderAccounts(now: number): void {
  interface Entry {
    email: string;
    signedIn: string[];
    pinned: string[];
    seen: boolean;
  }
  const accounts = new Map<string, Entry>();
  const entry = (email: string): Entry => {
    const key = accountKey(email);
    const existing = accounts.get(key) ?? { email, signedIn: [], pinned: [], seen: false };
    accounts.set(key, existing);
    return existing;
  };
  for (const id of MARKETPLACE_IDS) {
    const record = records[id];
    if (record.status === 'signed_in' && record.email) entry(record.email).signedIn.push(MARKETPLACES[id].code);
    const pin = pins[id];
    if (pin) entry(pin).pinned.push(MARKETPLACES[id].code);
    for (const event of history[id]) if (event.email && now - event.at < DAY) entry(event.email).seen = true;
  }
  // Timeline accounts whose last change was more than a day ago still colour today's bars.
  for (const id of MARKETPLACE_IDS) {
    for (const segment of timelineSegments(history[id], now)) if (segment.email) entry(segment.email).seen = true;
  }

  if (accounts.size === 0) {
    accountsHost.replaceChildren(el('li', 'accounts-empty', 'No accounts yet. Sign in on any Amazon marketplace and it shows up here.'));
    return;
  }

  const order = (e: Entry) => colors[accountKey(e.email)] ?? Number.MAX_SAFE_INTEGER;
  accountsHost.replaceChildren(
    ...[...accounts.values()]
      .sort((a, b) => order(a) - order(b) || a.email.localeCompare(b.email))
      .map(({ email, signedIn, pinned }) => {
        const item = el('li', 'account');
        const facts = [
          signedIn.length ? `Signed in on ${listOf(signedIn)}` : null,
          pinned.length ? `Pinned to ${listOf(pinned)}` : null,
        ].filter(Boolean);
        const where = facts.length ? `${facts.join('. ')}.` : 'Seen in the last 24 hours.';
        const body = el('div');
        body.append(el('p', 'account-name', email), el('p', 'account-where', where));
        item.append(avatar(email, colorOf(email)), body);
        return item;
      }),
  );
}

function render(reason: Reason): void {
  const now = Date.now();
  for (const id of MARKETPLACE_IDS) {
    const row = rows.get(id);
    if (row) renderRow(id, row, now, reason);
  }
  summary.textContent = boardSummary(
    MARKETPLACE_IDS.map((id) => records[id]),
    MARKETPLACE_IDS.map((id) => pins[id]),
  );
  renderAccounts(now);
}

async function reload(): Promise<void> {
  [records, pins, history, colors] = await Promise.all([
    authStore.getAll(),
    pinStore.getAll(),
    historyStore.getAll(),
    colorStore.get(),
  ]);
}

async function requestCheck(id: MarketplaceId): Promise<void> {
  checking.add(id);
  render('tick');
  try {
    const request: CheckRequest = { type: 'check', marketplace: id, force: true };
    await chrome.runtime.sendMessage(request);
  } catch (error) {
    console.warn('Check did not finish', id, error);
  } finally {
    checking.delete(id);
    await reload();
    render('live');
  }
}

async function checkAll(): Promise<void> {
  checkAllButton.disabled = true;
  checkAllButton.querySelector('.icon')?.classList.add('spin');
  for (const [index, id] of MARKETPLACE_IDS.entries()) {
    checkAllLabel.textContent = `Checking ${index + 1} of ${MARKETPLACE_IDS.length}`;
    await requestCheck(id);
    await sleep(300);
  }
  checkAllButton.querySelector('.icon')?.classList.remove('spin');
  checkAllButton.disabled = false;
  checkAllLabel.textContent = 'Check all';
}

async function init(): Promise<void> {
  applyLayout(layoutFor(window.innerWidth));
  buildRows();
  buildAxis();
  checkAllButton.prepend(icon('refresh'));
  await reload();
  render('initial');

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !touchesAuthState(Object.keys(changes))) return;
    void reload().then(() => render('live'));
  });

  checkAllButton.addEventListener('click', () => void checkAll());
  setInterval(() => render('tick'), RELABEL_EVERY_MS);

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const next = layoutFor(window.innerWidth);
      if (next !== layout) applyLayout(next);
    }, 120);
  });
}

void init();
