import { TEST_ALERT_ID } from './alerts';
import { avatar, byId, el, icon, paintAvatar } from './dom';
import { csvFileName, historyCsv, historyStats } from './export';
import { NAME_MAX_LENGTH, accountColor, accountKey, cleanName, nameFor, type AccountNames, type ColorSlots } from './identity';
import { MARKETPLACE_IDS, MARKETPLACES, type MarketplaceId } from './marketplaces';
import { ALERTS_KEY, alertStore, authStore, colorStore, historyStore, nameStore, pinStore, touchesAuthState } from './store';
import { EMPTY_RECORD, type AuthRecord, type HistoryEvent } from './types';
import { clockTime, dayAndTime, listOf } from './view';

// Settings: nicknames for accounts, desktop alerts and the history export. Everything here is
// stored in chrome.storage.local, like the rest of the extension, and never leaves the browser.

const SAVED_FOR_MS = 1600;

interface NameRow {
  key: string;
  email: string;
  element: HTMLLIElement;
  avatar: HTMLElement;
  where: HTMLElement;
  input: HTMLInputElement;
  saved: HTMLElement;
  savedTimer?: ReturnType<typeof setTimeout>;
}

const namesHost = byId<HTMLUListElement>('names');
const alertsSwitch = byId<HTMLButtonElement>('alerts-switch');
const testAlertButton = byId<HTMLButtonElement>('test-alert');
const testAlertLabel = byId('test-alert-label');
const historySummary = byId('history-summary');
const exportButton = byId<HTMLButtonElement>('export');
const announce = byId('announce');

const rows = new Map<string, NameRow>();
let records = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, EMPTY_RECORD])) as Record<MarketplaceId, AuthRecord>;
let pins = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, null])) as Record<MarketplaceId, string | null>;
let history = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, [] as HistoryEvent[]])) as Record<MarketplaceId, HistoryEvent[]>;
let colors: ColorSlots = {};
let names: AccountNames = {};
let alertsOn = false;
let saving: Promise<void> = Promise.resolve();
let testSentTimer: ReturnType<typeof setTimeout> | undefined;

// ---------- Account names ----------

/** Every account the extension knows: in colour order, so the list matches the board, then any left with only a nickname. */
function knownAccounts(): Array<{ key: string; email: string }> {
  const emails = new Map<string, string>();
  const note = (email: string | null | undefined) => {
    if (email && !emails.has(accountKey(email))) emails.set(accountKey(email), email.trim());
  };
  for (const id of MARKETPLACE_IDS) {
    note(records[id].status === 'signed_in' ? records[id].email : null);
    note(pins[id]);
    for (const event of history[id]) note(event.email);
  }
  Object.keys(colors).forEach(note);
  Object.keys(names).forEach(note);
  const order = (key: string) => colors[key] ?? Number.MAX_SAFE_INTEGER;
  return [...emails.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([key, email]) => ({ key, email }));
}

/** Where the account is now, or when it was last signed in. */
function whereText(key: string, now: number): string {
  const signedIn: string[] = [];
  const pinned: string[] = [];
  let lastSeen: number | null = null;
  for (const id of MARKETPLACE_IDS) {
    const record = records[id];
    if (record.status === 'signed_in' && record.email && accountKey(record.email) === key) signedIn.push(MARKETPLACES[id].code);
    const pin = pins[id];
    if (pin && accountKey(pin) === key) pinned.push(MARKETPLACES[id].code);
    const events = [...history[id]].sort((a, b) => a.at - b.at);
    events.forEach((event, index) => {
      if (!event.email || accountKey(event.email) !== key) return;
      const end = events[index + 1]?.at ?? now;
      lastSeen = Math.max(lastSeen ?? 0, end);
    });
  }
  const facts = [
    signedIn.length ? `Signed in on ${listOf(signedIn)}` : null,
    pinned.length ? `Pinned to ${listOf(pinned)}` : null,
  ].filter(Boolean);
  if (facts.length) return `${facts.join('. ')}.`;
  if (lastSeen !== null) return `Last signed in ${dayAndTime(lastSeen, now)}.`;
  return 'Not seen in the last 30 days.';
}

function showSaved(row: NameRow, message: string): void {
  row.saved.classList.add('is-visible');
  announce.textContent = message;
  clearTimeout(row.savedTimer);
  row.savedTimer = setTimeout(() => row.saved.classList.remove('is-visible'), SAVED_FOR_MS);
}

/** Saves one nickname. Saves run one at a time, so two quick edits cannot overwrite each other. */
function save(row: NameRow): Promise<void> {
  const raw = row.input.value;
  saving = saving
    .then(async () => {
      const before = nameFor(names, row.email) ?? '';
      if (cleanName(raw) === before) {
        row.input.value = before;
        return;
      }
      names = await nameStore.set(row.email, raw);
      const after = nameFor(names, row.email) ?? '';
      row.input.value = after;
      paintAvatar(row.avatar, row.email, accountColor(colors, row.email), after || null);
      showSaved(row, after ? `Nickname saved: ${after}` : `Nickname removed for ${row.email}`);
    })
    .catch((error) => console.warn('Nickname not saved', error));
  return saving;
}

function buildNameRow(key: string, email: string): NameRow {
  const element = el('li', 'name-row');
  element.dataset.key = key;
  const rowAvatar = avatar(email, accountColor(colors, email), nameFor(names, email));

  const who = el('div', 'name-who');
  const where = el('p', 'name-where');
  who.append(el('p', 'name-email', email), where);

  const field = el('div', 'name-field');
  const input = el('input', 'input');
  input.type = 'text';
  input.placeholder = 'Add a nickname';
  // Room for emoji, which take two units each. cleanName keeps the first 40 characters.
  input.maxLength = NAME_MAX_LENGTH * 2;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', `Nickname for ${email}`);
  input.setAttribute('aria-describedby', 'names-help');
  const saved = el('span', 'name-saved');
  saved.setAttribute('aria-hidden', 'true');
  saved.append(icon('done'), el('span', '', 'Saved'));
  field.append(input, saved);

  element.append(rowAvatar, who, field);
  const row: NameRow = { key, email, element, avatar: rowAvatar, where, input, saved };

  input.addEventListener('change', () => void save(row));
  // Both keys are handled here, so neither goes on to the browser (where Escape would mean "stop loading").
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save(row);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      input.value = nameFor(names, email) ?? '';
      input.blur();
    }
  });
  return row;
}

function renderNames(now: number): void {
  const accounts = knownAccounts();
  if (accounts.length === 0) {
    rows.clear();
    namesHost.replaceChildren(el('li', 'names-empty', 'No accounts yet. Sign in on any Amazon marketplace and it shows up here.'));
    return;
  }
  namesHost.querySelector('.names-empty')?.remove();

  const wanted = new Set(accounts.map((account) => account.key));
  for (const [key, row] of rows) {
    if (!wanted.has(key)) {
      row.element.remove();
      rows.delete(key);
    }
  }

  accounts.forEach(({ key, email }, index) => {
    let row = rows.get(key);
    if (!row) {
      row = buildNameRow(key, email);
      rows.set(key, row);
    }
    // Moving a row would take focus out of a field being typed in, so rows move only when out of place.
    if (namesHost.children[index] !== row.element) namesHost.insertBefore(row.element, namesHost.children[index] ?? null);
    const name = nameFor(names, email);
    paintAvatar(row.avatar, email, accountColor(colors, email), name);
    row.where.textContent = whereText(key, now);
    if (document.activeElement !== row.input) row.input.value = name ?? '';
  });
}

// ---------- Alerts ----------

function renderAlerts(): void {
  alertsSwitch.setAttribute('aria-checked', String(alertsOn));
  testAlertButton.disabled = !alertsOn;
}

async function toggleAlerts(): Promise<void> {
  alertsOn = !alertsOn;
  renderAlerts();
  await alertStore.set(alertsOn);
  announce.textContent = alertsOn ? 'Desktop alerts on' : 'Desktop alerts off';
}

async function sendTestAlert(): Promise<void> {
  try {
    await chrome.notifications.create(TEST_ALERT_ID, {
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: 'Alerts are on',
      message: 'This is how a sign-out or the wrong account will show. Nothing changed on Amazon.',
      priority: 1,
    });
    testAlertLabel.textContent = 'Test alert sent';
    announce.textContent = 'Test alert sent';
  } catch (error) {
    console.warn('Test alert failed', error);
    testAlertLabel.textContent = 'Chrome could not show it';
    announce.textContent = 'Chrome could not show the test alert';
  }
  clearTimeout(testSentTimer);
  testSentTimer = setTimeout(() => (testAlertLabel.textContent = 'Send a test alert'), 2500);
}

// ---------- History ----------

/** "since 17:24", "since yesterday 09:15" or "since 3 Nov". */
function since(ms: number, now: number): string {
  const text = dayAndTime(ms, now);
  if (text.startsWith('today ')) return `since ${clockTime(ms)}`;
  if (text.startsWith('yesterday ')) return `since ${text}`;
  return `since ${text.slice(0, text.lastIndexOf(' '))}`;
}

function renderHistory(now: number): void {
  const { periods, since: oldest } = historyStats(history);
  exportButton.disabled = periods === 0;
  historySummary.textContent =
    periods === 0 || oldest === null ? 'No history yet' : `${periods} ${periods === 1 ? 'change' : 'changes'} ${since(oldest, now)}`;
}

function exportHistory(): void {
  const csv = historyCsv(history, names);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = el('a');
  link.href = url;
  link.download = csvFileName(Date.now());
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  announce.textContent = 'History exported';
}

// ---------- Page ----------

async function reload(): Promise<void> {
  [records, pins, history, colors, names, alertsOn] = await Promise.all([
    authStore.getAll(),
    pinStore.getAll(),
    historyStore.getAll(),
    colorStore.get(),
    nameStore.get(),
    alertStore.enabled(),
  ]);
}

function render(): void {
  const now = Date.now();
  renderNames(now);
  renderAlerts();
  renderHistory(now);
}

async function init(): Promise<void> {
  byId('open-board').prepend(icon('board'));
  exportButton.prepend(icon('download'));
  await reload();
  render();

  alertsSwitch.addEventListener('click', () => void toggleAlerts());
  testAlertButton.addEventListener('click', () => void sendTestAlert());
  exportButton.addEventListener('click', exportHistory);

  // Another tab or the service worker changed something: a new account, a sign-out, alerts toggled elsewhere.
  chrome.storage.onChanged.addListener((changes, area) => {
    const keys = Object.keys(changes);
    if (area !== 'local' || !(touchesAuthState(keys) || keys.includes(ALERTS_KEY))) return;
    void reload().then(render);
  });
}

void init();
