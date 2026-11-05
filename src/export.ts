import { nameFor, type AccountNames } from './identity';
import { MARKETPLACE_IDS, MARKETPLACES, type MarketplaceId } from './marketplaces';
import type { HistoryEvent } from './types';

// The history as a spreadsheet, for questions such as "which account placed that order?".
// Built in the page and saved by the browser, so nothing is uploaded anywhere.

export const CSV_HEADER = ['Marketplace', 'State', 'Account', 'Nickname', 'From', 'To'];

// Excel and Google Sheets run a cell that starts with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

/** One quoted cell. A leading formula character gets an apostrophe first, so "+44 7700 900123" stays text. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Local time as spreadsheets read it: 2026-11-05 17:24:27. */
export function localTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export type History = Record<MarketplaceId, HistoryEvent[]>;

/**
 * One line per stretch of time with the same account, per marketplace, oldest first. "To" is empty
 * for the stretch that is still going on. Lines end in CRLF, as RFC 4180 asks.
 */
export function historyCsv(history: History, names: AccountNames): string {
  const lines: string[][] = [CSV_HEADER];
  for (const id of MARKETPLACE_IDS) {
    const events = [...history[id]].sort((a, b) => a.at - b.at);
    events.forEach((event, index) => {
      const next = events[index + 1];
      lines.push([
        MARKETPLACES[id].domain,
        event.email ? 'Signed in' : 'Signed out',
        event.email ?? '',
        nameFor(names, event.email) ?? '',
        localTimestamp(event.at),
        next ? localTimestamp(next.at) : '',
      ]);
    });
  }
  // The byte order mark tells Excel the file is UTF-8, so nicknames in any script open correctly.
  return `﻿${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function csvFileName(now: number): string {
  const d = new Date(now);
  return `amazon-accounts-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
}

/** How much history there is: the number of stretches the export will hold, and when the oldest began. */
export function historyStats(history: History): { periods: number; since: number | null } {
  const events = MARKETPLACE_IDS.flatMap((id) => history[id]);
  const since = events.length ? Math.min(...events.map((event) => event.at)) : null;
  return { periods: events.length, since };
}
