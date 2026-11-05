import type { AuthRecord, HistoryEvent } from './types';

const HOUR = 3_600_000;
/** Long enough to answer "which account placed that order?" for a return or a dispute. */
export const HISTORY_RETENTION_MS = 30 * 24 * HOUR;
export const HISTORY_MAX_EVENTS = 1000;
export const TIMELINE_WINDOW_MS = 24 * HOUR;

/**
 * Who a record says is signed in, for the timeline. Only conclusive answers count:
 * a failed check says nothing new about the session, and a signed-in record without
 * an email cannot be told apart from another account.
 */
export function identityOf(record: AuthRecord): { email: string | null } | undefined {
  if (record.problem !== null && record.problem !== 'email_unavailable') return undefined;
  if (record.status === 'signed_out') return { email: null };
  if (record.status === 'signed_in' && record.email) return { email: record.email };
  return undefined;
}

/** Adds an event when the signed-in account changed, and forgets events older than the retention. */
export function appendHistory(events: HistoryEvent[], record: AuthRecord, now: number): HistoryEvent[] {
  const identity = identityOf(record);
  const kept = events.filter((event) => now - event.at <= HISTORY_RETENTION_MS);
  if (!identity) return kept;
  const last = kept.at(-1);
  if (last && sameAccount(last.email, identity.email)) return kept;
  return [...kept, { at: now, email: identity.email }].slice(-HISTORY_MAX_EVENTS);
}

export function sameAccount(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface TimelineSegment {
  /** Fractions of the window, from 0 (oldest) to 1 (now). */
  start: number;
  end: number;
  /** null while signed out. */
  email: string | null;
  from: number;
  to: number;
}

/** The parts of the last 24 hours with a known account. Time before the first event stays empty. */
export function timelineSegments(events: HistoryEvent[], now: number, windowMs = TIMELINE_WINDOW_MS): TimelineSegment[] {
  const windowStart = now - windowMs;
  const segments: TimelineSegment[] = [];
  const ordered = [...events].sort((a, b) => a.at - b.at);
  ordered.forEach((event, index) => {
    const next = ordered[index + 1];
    const from = Math.max(event.at, windowStart);
    const to = Math.min(next ? next.at : now, now);
    if (to <= from) return;
    segments.push({
      start: (from - windowStart) / windowMs,
      end: (to - windowStart) / windowMs,
      email: event.email,
      from,
      to,
    });
  });
  return segments;
}
