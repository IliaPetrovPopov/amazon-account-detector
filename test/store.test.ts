import { afterEach, beforeEach, describe as group, expect, it, vi } from 'vitest';
import {
  alertStore,
  authStore,
  colorStore,
  historyStore,
  loadSelectedMarketplace,
  nameStore,
  pinStore,
  touchesAccounts,
  touchesAuthState,
} from '../src/store';
import { EMPTY_RECORD, type AuthRecord } from '../src/types';

const NOW = 1_800_000_000_000;

/** A stand-in for chrome.storage.local, enough for the store module. */
function fakeChrome() {
  const data = new Map<string, unknown>();
  const local = {
    get: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => data.has(k)).map((k) => [k, structuredClone(data.get(k))]));
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
    }),
    remove: vi.fn(async (key: string) => void data.delete(key)),
  };
  return { data, local };
}

let storage: ReturnType<typeof fakeChrome>;

beforeEach(() => {
  storage = fakeChrome();
  vi.stubGlobal('chrome', { storage: { local: storage.local } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const alice: AuthRecord = { ...EMPTY_RECORD, status: 'signed_in', email: 'alice@example.test' };

group('authStore', () => {
  it('falls back to an empty record for every marketplace', async () => {
    const all = await authStore.getAll();
    expect(Object.keys(all)).toEqual(['com', 'co.uk', 'de', 'it', 'fr']);
    expect(all.de).toEqual(EMPTY_RECORD);
  });

  it('round-trips a record', async () => {
    await authStore.set('de', alice);
    expect(await authStore.get('de')).toEqual(alice);
    expect((await authStore.getAll()).de).toEqual(alice);
  });
});

group('pinStore', () => {
  it('stores and clears a pin', async () => {
    await pinStore.set('de', 'alice@example.test');
    expect(await pinStore.get('de')).toBe('alice@example.test');
    expect((await pinStore.getAll()).de).toBe('alice@example.test');
    await pinStore.set('de', null);
    expect(await pinStore.get('de')).toBeNull();
    expect(storage.data.has('pin:de')).toBe(false);
  });
});

group('historyStore', () => {
  it('appends changes and skips writes that change nothing', async () => {
    await historyStore.record('de', alice, NOW);
    await historyStore.record('de', alice, NOW + 1000);
    await historyStore.record('de', { ...EMPTY_RECORD, status: 'signed_out' }, NOW + 2000);
    expect((await historyStore.getAll()).de).toEqual([
      { at: NOW, email: 'alice@example.test' },
      { at: NOW + 2000, email: null },
    ]);
    expect(storage.local.set).toHaveBeenCalledTimes(2);
  });
});

group('colorStore', () => {
  it('starts empty and round-trips the colours', async () => {
    expect(await colorStore.get()).toEqual({});
    await colorStore.set({ 'alice@example.test': 0, 'bob@example.test': 1 });
    expect(await colorStore.get()).toEqual({ 'alice@example.test': 0, 'bob@example.test': 1 });
  });
});

group('selection', () => {
  it('defaults to amazon.com and ignores unknown values', async () => {
    expect(await loadSelectedMarketplace()).toBe('com');
    storage.data.set('selectedMarketplace', 'jp');
    expect(await loadSelectedMarketplace()).toBe('com');
    storage.data.set('selectedMarketplace', 'fr');
    expect(await loadSelectedMarketplace()).toBe('fr');
  });
});

group('touchesAuthState', () => {
  it('reacts to records, pins, history, colours and the selection only', () => {
    expect(touchesAuthState(['auth:de'])).toBe(true);
    expect(touchesAuthState(['pin:fr'])).toBe(true);
    expect(touchesAuthState(['history:it'])).toBe(true);
    expect(touchesAuthState(['accountColors'])).toBe(true);
    expect(touchesAuthState(['accountNames'])).toBe(true);
    expect(touchesAuthState(['alertsEnabled'])).toBe(false);
    expect(touchesAuthState(['selectedMarketplace'])).toBe(true);
    expect(touchesAuthState(['something-else'])).toBe(false);
    expect(touchesAuthState([])).toBe(false);
  });
});

group('touchesAccounts', () => {
  it('reacts to pins only: records reach the colours through the service worker directly', () => {
    expect(touchesAccounts(['pin:de'])).toBe(true);
    expect(touchesAccounts(['auth:de', 'history:de', 'accountColors', 'selectedMarketplace'])).toBe(false);
  });
});

group('nameStore', () => {
  it('stores cleaned nicknames by normalised email and removes empty ones', async () => {
    expect(await nameStore.get()).toEqual({});
    expect(await nameStore.set('Alice@Example.test', '  Main  buyer ')).toEqual({ 'alice@example.test': 'Main buyer' });
    await nameStore.set('bob@example.test', 'Backup');
    expect(storage.data.get('accountNames')).toEqual({ 'alice@example.test': 'Main buyer', 'bob@example.test': 'Backup' });
    await nameStore.set('alice@example.test', '');
    expect(await nameStore.get()).toEqual({ 'bob@example.test': 'Backup' });
  });
});

group('alertStore', () => {
  it('is off until turned on, and turning it off leaves nothing behind', async () => {
    expect(await alertStore.enabled()).toBe(false);
    await alertStore.set(true);
    expect(await alertStore.enabled()).toBe(true);
    await alertStore.set(false);
    expect(await alertStore.enabled()).toBe(false);
    expect(storage.data.has('alertsEnabled')).toBe(false);
  });
});
