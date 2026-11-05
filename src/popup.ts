import { accountName, avatar, byId, el, icon, memory, paintAvatar, prefersReducedMotion, setIcon, setText, settleIn } from './dom';
import { accountColor, accountLabel, nameFor, type AccountNames, type ColorSlots } from './identity';
import { comboKey, typeahead } from './listbox';
import type { CheckRequest } from './messages';
import { MARKETPLACE_IDS, MARKETPLACES, type MarketplaceId } from './marketplaces';
import { authStore, colorStore, loadSelectedMarketplace, nameStore, pinStore, saveSelectedMarketplace, touchesAuthState } from './store';
import { EMPTY_RECORD, type AuthRecord } from './types';
import { boardRow, changeNote, describe, emailLines, heroText, lookOf, type Look } from './view';

/** Avoids a "Checking…" flash when the answer is already cached. */
const SHOW_CHECKING_AFTER_MS = 200;
const RELABEL_EVERY_MS = 30_000;
/** Who each marketplace showed the last time the popup displayed it. */
const SEEN_KEY = 'popup:seen';
const TYPEAHEAD_RESET_MS = 700;

type Reason = 'open' | 'choose' | 'live' | 'tick';
type Note = ReturnType<typeof changeNote>;

const combo = byId('combo');
const comboCode = byId('combo-code');
const comboName = byId('combo-name');
const comboDomain = byId('combo-domain');
const comboDot = byId('combo-dot');
const listbox = byId<HTMLUListElement>('listbox');
const identity = byId('identity');
const avatarHost = byId('avatar');
const primary = byId('primary');
const secondary = byId('secondary');
const account = byId('account');
const statusPill = byId('status');
const statusText = byId('status-text');
const freshness = byId('freshness');
const changeBox = byId('change');
const changeText = byId('change-text');
const changeBefore = byId('change-before');
const alertBox = byId('alert');
const alertText = byId('alert-text');
const alertWho = byId('alert-who');
const repinButton = byId<HTMLButtonElement>('repin');
const noticeBox = byId('notice-box');
const notice = byId('notice');
const action = byId<HTMLAnchorElement>('action');
const checkButton = byId<HTMLButtonElement>('check');
const checkLabel = byId('check-label');
const copyButton = byId<HTMLButtonElement>('copy');
const pinButton = byId<HTMLButtonElement>('pin');
const pinLabel = byId('pin-label');
const announce = byId('announce');

interface Option {
  element: HTMLLIElement;
  dot: HTMLElement;
  avatar: HTMLElement;
  account: HTMLElement;
}

const options = new Map<MarketplaceId, Option>();
const searchLabels = MARKETPLACE_IDS.map((id) => `${MARKETPLACES[id].code} ${MARKETPLACES[id].label} ${MARKETPLACES[id].domain}`);

let selected: MarketplaceId = 'com';
let records = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, EMPTY_RECORD])) as Record<MarketplaceId, AuthRecord>;
let pins = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, null])) as Record<MarketplaceId, string | null>;
let colors: ColorSlots = {};
let names: AccountNames = {};
const checking = new Set<MarketplaceId>();
/** Changes that happened while the popup was closed, found when it opened. */
let notes: Partial<Record<MarketplaceId, Note>> = {};
/** What the main area showed last, so only a real change moves it. */
let shownKey = '';
let windowId: number | undefined;
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

let listOpen = false;
let active = 0;
let typed = '';
let typedTimer: ReturnType<typeof setTimeout> | undefined;

const colorOf = (email: string | null) => (email ? accountColor(colors, email) : null);

// ---------- The dropdown ----------

function buildOptions(): void {
  MARKETPLACE_IDS.forEach((id, index) => {
    const m = MARKETPLACES[id];
    const element = el('li', 'option');
    element.id = `option-${id.replace('.', '-')}`;
    element.dataset.id = id;
    element.setAttribute('role', 'option');

    const code = el('span', 'code', m.code);
    code.setAttribute('aria-hidden', 'true');
    const text = el('span', 'option-text');
    text.setAttribute('aria-hidden', 'true');
    text.append(el('span', 'option-name', m.label), el('span', 'option-domain', m.domain));

    const accountBox = el('span', 'option-account');
    accountBox.setAttribute('aria-hidden', 'true');
    const dot = el('span', 'dot');
    const optionAvatar = avatar(null, null);
    const accountText = el('span');
    accountBox.append(dot, optionAvatar, accountText);

    element.append(code, text, accountBox);
    // Keep focus on the combobox, as a native select does.
    element.addEventListener('mousedown', (event) => event.preventDefault());
    element.addEventListener('mousemove', () => {
      if (active !== index) setActive(index);
    });
    element.addEventListener('click', () => {
      closeList();
      choose(id);
    });
    listbox.append(element);
    options.set(id, { element, dot, avatar: optionAvatar, account: accountText });
  });
}

function setActive(index: number): void {
  active = index;
  MARKETPLACE_IDS.forEach((id, i) => options.get(id)?.element.classList.toggle('is-active', i === index));
  const option = options.get(MARKETPLACE_IDS[index] ?? selected);
  if (!option) return;
  combo.setAttribute('aria-activedescendant', option.element.id);
  option.element.scrollIntoView({ block: 'nearest' });
}

function openList(index: number): void {
  if (!listOpen) {
    listOpen = true;
    listbox.hidden = false;
    combo.setAttribute('aria-expanded', 'true');
    // The popup window only grows with the page, so the open list gets room to show in full.
    const bottom = Math.ceil(listbox.getBoundingClientRect().bottom + window.scrollY + 16);
    if (bottom > document.documentElement.scrollHeight) document.body.style.minHeight = `${bottom}px`;
    if (!prefersReducedMotion()) {
      listbox.animate(
        [
          { opacity: 0, transform: 'translateY(-4px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 140, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
      );
    }
  }
  setActive(index);
}

function closeList(): void {
  listOpen = false;
  typed = '';
  listbox.hidden = true;
  combo.setAttribute('aria-expanded', 'false');
  combo.removeAttribute('aria-activedescendant');
  document.body.style.minHeight = '';
}

function onComboKey(event: KeyboardEvent): void {
  const current = MARKETPLACE_IDS.indexOf(selected);
  const from = listOpen ? active : current;

  const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (printable && !(event.key === ' ' && typed === '')) {
    event.preventDefault();
    clearTimeout(typedTimer);
    typed += event.key;
    typedTimer = setTimeout(() => (typed = ''), TYPEAHEAD_RESET_MS);
    // A repeated first letter moves on to the next match; a longer word refines from here.
    const match = typeahead(searchLabels, typed, typed.length > 1 ? from - 1 : from);
    if (match >= 0) openList(match);
    return;
  }

  const result = comboKey(event.key, listOpen, from, MARKETPLACE_IDS.length, event.altKey);
  if (result.type === 'none') return;
  if (event.key !== 'Tab') event.preventDefault();
  switch (result.type) {
    case 'open':
      openList(result.active);
      break;
    case 'move':
      setActive(result.active);
      break;
    case 'select': {
      closeList();
      const id = MARKETPLACE_IDS[result.index];
      if (id) choose(id);
      break;
    }
    case 'close':
      closeList();
      break;
  }
}

function renderCombo(now: number): void {
  const m = MARKETPLACES[selected];
  comboCode.textContent = m.code;
  comboName.textContent = m.label;
  comboDomain.textContent = m.domain;

  for (const id of MARKETPLACE_IDS) {
    const option = options.get(id);
    if (!option) continue;
    const row = boardRow(records[id], MARKETPLACES[id], now, pins[id], names);
    const email = row.account || null;
    option.element.setAttribute('aria-selected', String(id === selected));
    option.element.setAttribute('aria-label', `${row.country}, ${row.label}`);
    option.element.dataset.tone = row.tone;
    option.dot.dataset.tone = row.tone;
    option.avatar.hidden = email === null;
    paintAvatar(option.avatar, email, colorOf(email), row.name);
    // A nickname, or the part of the email that tells accounts apart. The whole label is read out.
    option.account.textContent = email ? (row.name ?? emailLines(email)[0]) : row.status;
    option.element.querySelector('.code')?.classList.toggle('is-current', id === selected);
    if (id === selected) comboDot.dataset.tone = row.tone;
  }
}

// ---------- The selected marketplace ----------

function render(reason: Reason): void {
  const now = Date.now();
  const m = MARKETPLACES[selected];
  const record = records[selected];
  const pin = pins[selected];
  const isChecking = checking.has(selected);
  const view = describe(record, m, now, isChecking, pin);
  const hero = heroText(record, m, names);

  renderCombo(now);

  paintAvatar(avatarHost, hero.email, colorOf(hero.email), hero.name);
  primary.textContent = hero.primary;
  secondary.textContent = hero.secondary;
  identity.classList.toggle('is-faded', hero.email !== null && view.accountMuted);
  identity.classList.toggle('has-name', hero.name !== null);
  account.textContent = `${m.domain}: ${view.headline}${hero.email ? `, ${accountLabel(names, hero.email)}` : ''}`;

  statusPill.dataset.tone = view.tone;
  statusText.textContent = view.status;
  freshness.textContent = view.freshness;

  const key = `${selected}|${hero.primary}|${hero.secondary}|${view.status}`;
  const changed = shownKey !== '' && key !== shownKey;
  if (changed && reason === 'live') notes[selected] = null;
  // Screen readers hear the new answer, and the account after a marketplace is chosen.
  if (changed && (reason === 'live' || reason === 'choose')) announce.textContent = account.textContent;
  if ((changed && reason !== 'tick') || (reason === 'open' && notes[selected])) settleIn(identity);
  shownKey = key;

  const note = notes[selected];
  changeBox.hidden = !note;
  if (note) {
    changeText.textContent = note.text;
    changeBefore.hidden = !note.before;
    if (note.before) {
      const name = nameFor(names, note.before);
      changeBefore.replaceChildren('Before:', avatar(note.before, colorOf(note.before), name), accountName(note.before, name));
    }
  }

  const mismatch = view.pin.state === 'mismatch' && view.pin.email;
  alertBox.hidden = !mismatch;
  if (mismatch && view.pin.email) {
    alertText.textContent = `${m.domain} is pinned to`;
    const name = nameFor(names, view.pin.email);
    alertWho.replaceChildren(avatar(view.pin.email, colorOf(view.pin.email), name), accountName(view.pin.email, name, 'alert-email'));
  }

  noticeBox.hidden = view.notice === null;
  setText(notice, view.notice);

  action.hidden = !view.action;
  if (view.action) {
    action.textContent = view.action.label;
    action.href = view.action.url;
    action.dataset.primary = String(view.action.primary);
    action.classList.toggle('button-primary', view.action.primary);
  }

  checkButton.disabled = isChecking;
  checkLabel.textContent = isChecking ? 'Checking…' : 'Check now';
  checkButton.querySelector('.icon')?.classList.toggle('spin', isChecking);

  copyButton.hidden = !hero.email;
  pinButton.hidden = !hero.email;
  if (hero.email) {
    const pinnedHere = view.pin.state === 'match';
    pinButton.setAttribute('aria-pressed', String(pinnedHere));
    pinButton.setAttribute('aria-label', `Pin this account to ${m.domain}`);
    pinButton.title = pinnedHere ? `Pinned to ${m.domain}. Click to unpin.` : `Expect this account on ${m.domain}`;
    pinLabel.textContent = pinnedHere ? 'Pinned' : 'Pin account';
  }

  const look = lookOf(record);
  if (look) {
    const seen = memory.read<Partial<Record<MarketplaceId, Look>>>(SEEN_KEY, {});
    seen[selected] = look;
    memory.write(SEEN_KEY, seen);
  }
}

async function reload(): Promise<void> {
  [records, pins, colors, names] = await Promise.all([authStore.getAll(), pinStore.getAll(), colorStore.get(), nameStore.get()]);
}

async function requestCheck(id: MarketplaceId, force: boolean): Promise<void> {
  const showChecking = setTimeout(() => {
    checking.add(id);
    render('tick');
  }, SHOW_CHECKING_AFTER_MS);
  try {
    const request: CheckRequest = { type: 'check', marketplace: id, force };
    await chrome.runtime.sendMessage(request);
  } catch (error) {
    // The worker can restart mid-check. The cached record stays on screen, labelled by its age.
    console.warn('Check did not finish', id, error);
  } finally {
    clearTimeout(showChecking);
    checking.delete(id);
    await reload();
    render('live');
  }
}

function choose(id: MarketplaceId): void {
  if (id === selected) return;
  selected = id;
  void saveSelectedMarketplace(id);
  render('choose');
  void requestCheck(id, false);
}

function buildTools(): void {
  byId('open-board').append(icon('board'));
  byId('open-panel').append(icon('panel'));
  byId('open-settings').append(icon('settings'));
  byId('combo-chevron').append(icon('chevron'));
  byId('change-icon').append(icon('history'));
  byId('alert-icon').append(icon('alert'));
  byId('notice-icon').append(icon('info'));
  copyButton.append(icon('copy'));
  checkButton.prepend(icon('refresh'));
  pinButton.prepend(icon('pin'));

  byId('open-board').addEventListener('click', () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('board.html') }).then(() => window.close());
  });

  byId('open-settings').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage().then(() => window.close());
  });

  // sidePanel.open needs the click's user gesture, so the window id is looked up in advance.
  byId('open-panel').addEventListener('click', () => {
    if (windowId === undefined) return;
    chrome.sidePanel
      .open({ windowId })
      .then(() => window.close())
      .catch((error: unknown) => console.warn('Side panel did not open', error));
  });

  combo.addEventListener('click', () => {
    if (listOpen) closeList();
    else openList(MARKETPLACE_IDS.indexOf(selected));
  });
  combo.addEventListener('keydown', onComboKey);
  combo.addEventListener('blur', () => {
    if (listOpen) closeList();
  });

  checkButton.addEventListener('click', () => void requestCheck(selected, true));

  copyButton.addEventListener('click', () => {
    const email = records[selected].email;
    if (!email) return;
    void navigator.clipboard.writeText(email).then(() => {
      setIcon(copyButton, 'done');
      copyButton.classList.add('is-done');
      copyButton.setAttribute('aria-label', 'Email copied');
      announce.textContent = 'Email copied';
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => {
        setIcon(copyButton, 'copy');
        copyButton.classList.remove('is-done');
        copyButton.setAttribute('aria-label', 'Copy email');
      }, 1500);
    });
  });

  const pinCurrent = () => {
    const email = records[selected].status === 'signed_in' ? records[selected].email : null;
    if (email) void pinStore.set(selected, email);
  };
  pinButton.addEventListener('click', () => {
    if (pinButton.getAttribute('aria-pressed') === 'true') void pinStore.set(selected, null);
    else pinCurrent();
  });
  repinButton.addEventListener('click', pinCurrent);
}

async function init(): Promise<void> {
  buildOptions();
  buildTools();

  selected = await loadSelectedMarketplace();
  await reload();

  const seen = memory.read<Partial<Record<MarketplaceId, Look>>>(SEEN_KEY, {});
  notes = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, changeNote(seen[id], records[id])]));
  render('open');

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !touchesAuthState(Object.keys(changes))) return;
    void reload().then(() => render('live'));
  });
  setInterval(() => render('tick'), RELABEL_EVERY_MS);

  void chrome.windows.getCurrent().then((window) => {
    windowId = window.id;
  });
  void requestCheck(selected, false);
}

void init();
