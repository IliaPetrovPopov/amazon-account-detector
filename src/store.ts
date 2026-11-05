import { appendHistory } from './history';
import { withName, type AccountNames, type ColorSlots } from './identity';
import { MARKETPLACE_IDS, isMarketplaceId, type MarketplaceId } from './marketplaces';
import { EMPTY_RECORD, type AuthRecord, type HistoryEvent } from './types';

// Everything lives in storage.local: it survives browser restarts and is never synced to other devices.

export const SELECTED_KEY = 'selectedMarketplace';
export const COLORS_KEY = 'accountColors';
export const NAMES_KEY = 'accountNames';
export const ALERTS_KEY = 'alertsEnabled';
export const authKey = (id: MarketplaceId) => `auth:${id}`;
export const pinKey = (id: MarketplaceId) => `pin:${id}`;
export const historyKey = (id: MarketplaceId) => `history:${id}`;

type PerMarketplace<T> = Record<MarketplaceId, T>;

async function readAll<T>(keyOf: (id: MarketplaceId) => string, fallback: T): Promise<PerMarketplace<T>> {
  const found = await chrome.storage.local.get(MARKETPLACE_IDS.map(keyOf));
  return Object.fromEntries(
    MARKETPLACE_IDS.map((id) => [id, (found[keyOf(id)] as T | undefined) ?? fallback]),
  ) as PerMarketplace<T>;
}

export const authStore = {
  async get(id: MarketplaceId): Promise<AuthRecord> {
    const key = authKey(id);
    const found = await chrome.storage.local.get(key);
    return (found[key] as AuthRecord | undefined) ?? EMPTY_RECORD;
  },
  getAll: () => readAll<AuthRecord>(authKey, EMPTY_RECORD),
  async set(id: MarketplaceId, record: AuthRecord): Promise<void> {
    await chrome.storage.local.set({ [authKey(id)]: record });
  },
};

/** The account a marketplace is supposed to use, set by the person. */
export const pinStore = {
  async get(id: MarketplaceId): Promise<string | null> {
    const key = pinKey(id);
    const found = await chrome.storage.local.get(key);
    return (found[key] as string | undefined) ?? null;
  },
  getAll: () => readAll<string | null>(pinKey, null),
  async set(id: MarketplaceId, email: string | null): Promise<void> {
    if (email) await chrome.storage.local.set({ [pinKey(id)]: email });
    else await chrome.storage.local.remove(pinKey(id));
  },
};

/** Who was signed in when, kept for 30 days. Written only by the service worker. */
export const historyStore = {
  getAll: () => readAll<HistoryEvent[]>(historyKey, []),
  async record(id: MarketplaceId, record: AuthRecord, now: number): Promise<void> {
    const key = historyKey(id);
    const found = await chrome.storage.local.get(key);
    const events = (found[key] as HistoryEvent[] | undefined) ?? [];
    const next = appendHistory(events, record, now);
    if (next.length !== events.length || next.at(-1) !== events.at(-1)) {
      await chrome.storage.local.set({ [key]: next });
    }
  },
};

/** Which colour each account was given. Written only by the service worker. */
export const colorStore = {
  async get(): Promise<ColorSlots> {
    const found = await chrome.storage.local.get(COLORS_KEY);
    return (found[COLORS_KEY] as ColorSlots | undefined) ?? {};
  },
  async set(slots: ColorSlots): Promise<void> {
    await chrome.storage.local.set({ [COLORS_KEY]: slots });
  },
};

/** Nicknames for accounts. Written only from the Settings page. */
export const nameStore = {
  async get(): Promise<AccountNames> {
    const found = await chrome.storage.local.get(NAMES_KEY);
    return (found[NAMES_KEY] as AccountNames | undefined) ?? {};
  },
  /** Saves a cleaned nickname, or removes it when nothing is left after cleaning. Returns what was stored. */
  async set(email: string, raw: string): Promise<AccountNames> {
    const next = withName(await nameStore.get(), email, raw);
    await chrome.storage.local.set({ [NAMES_KEY]: next });
    return next;
  },
};

/** Desktop alerts stay off until the person turns them on in Settings. */
export const alertStore = {
  async enabled(): Promise<boolean> {
    const found = await chrome.storage.local.get(ALERTS_KEY);
    return found[ALERTS_KEY] === true;
  },
  async set(on: boolean): Promise<void> {
    if (on) await chrome.storage.local.set({ [ALERTS_KEY]: true });
    else await chrome.storage.local.remove(ALERTS_KEY);
  },
};

export async function loadSelectedMarketplace(): Promise<MarketplaceId> {
  const found = await chrome.storage.local.get(SELECTED_KEY);
  const value: unknown = found[SELECTED_KEY];
  return isMarketplaceId(value) ? value : 'com';
}

export async function saveSelectedMarketplace(id: MarketplaceId): Promise<void> {
  await chrome.storage.local.set({ [SELECTED_KEY]: id });
}

/** True when a storage change can alter what the badge, the popup or the board shows. */
export function touchesAuthState(changedKeys: string[]): boolean {
  return changedKeys.some(
    (key) =>
      key === SELECTED_KEY ||
      key === COLORS_KEY ||
      key === NAMES_KEY ||
      key.startsWith('auth:') ||
      key.startsWith('pin:') ||
      key.startsWith('history:'),
  );
}

/** True when a storage change can bring a new account into view, so it may need a colour. */
export function touchesAccounts(changedKeys: string[]): boolean {
  return changedKeys.some((key) => key.startsWith('pin:'));
}
