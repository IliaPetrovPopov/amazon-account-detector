import { sameAccount } from './history';
import type { HistoryEvent } from './types';

/**
 * Account colours, in the order they are handed out: the first account the extension sees
 * gets the first colour. One set serves light and dark mode: each carries white initials at
 * 4.5:1 or better and stands out at 3:1 on both surfaces. The hues stay clear of the status
 * colours (green, amber, red, grey), so an account is never mistaken for a state. The first
 * three stay apart for colour-blind readers even side by side, and every neighbour pair does
 * on the timeline (checked under protanopia and deuteranopia simulation).
 */
export const ACCOUNT_COLORS = ['#853FD8', '#0E7A9B', '#D5217E', '#006CB4', '#A85334'] as const;

/** The colour each account was given, by normalised email. Stored, so an account keeps it. */
export type ColorSlots = Record<string, number>;

export const accountKey = (email: string): string => email.trim().toLowerCase();

function hashSlot(key: string): number {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % ACCOUNT_COLORS.length;
}

/**
 * Keeps the colour of every account still around, gives each new account the first free
 * colour, and frees the colours of accounts that are gone. `known` lists accounts in the order
 * they first appeared, so earlier accounts get the earlier, best-separated colours. Only when
 * more accounts than colours are around do two of them share one.
 */
export function assignColors(slots: ColorSlots, known: string[]): ColorSlots {
  const keys = [...new Set(known.map(accountKey).filter(Boolean))];
  const next: ColorSlots = {};
  for (const key of keys) {
    const slot = slots[key];
    if (slot !== undefined && slot >= 0 && slot < ACCOUNT_COLORS.length) next[key] = slot;
  }
  for (const key of keys) {
    if (next[key] !== undefined) continue;
    const used = new Set(Object.values(next));
    const free = ACCOUNT_COLORS.findIndex((_, index) => !used.has(index));
    next[key] = free === -1 ? hashSlot(key) : free;
  }
  return next;
}

export function sameColors(a: ColorSlots, b: ColorSlots): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** Accounts in the order they first appeared: the history first, then today's answers and pins. */
export function accountsInOrder(history: HistoryEvent[], current: Array<string | null>): string[] {
  const events = [...history].sort((a, b) => a.at - b.at);
  return [...events.map((event) => event.email), ...current].filter((email): email is string => Boolean(email));
}

/**
 * An account's colour. Before the service worker has handed one out, the colour it is about to
 * hand out: the first free one, so a new account does not flash one colour and then another.
 */
export function accountColor(slots: ColorSlots, email: string): string {
  const key = accountKey(email);
  const stored = slots[key];
  if (stored !== undefined && ACCOUNT_COLORS[stored]) return ACCOUNT_COLORS[stored];
  const used = new Set(Object.values(slots));
  const free = ACCOUNT_COLORS.findIndex((_, index) => !used.has(index));
  return ACCOUNT_COLORS[free === -1 ? hashSlot(key) : free] ?? ACCOUNT_COLORS[0];
}

/**
 * One or two letters for an account's avatar: alice.lindqvist@… is AL, bob@… is B.
 * Empty when there are no letters, such as a phone number, and the avatar shows a person instead.
 */
export function monogram(email: string): string {
  const at = email.lastIndexOf('@');
  const local = at > 0 ? email.slice(0, at) : email;
  const words = local.split(/[^\p{L}]+/u).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toLocaleUpperCase();
}

export type PinState = 'none' | 'match' | 'mismatch';

/** Whether the signed-in account is the one pinned for this marketplace. */
export function pinState(pin: string | null | undefined, signedInEmail: string | null): PinState {
  if (!pin) return 'none';
  if (!signedInEmail) return 'none';
  return sameAccount(pin, signedInEmail) ? 'match' : 'mismatch';
}
