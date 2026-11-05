import { describe as group, expect, it } from 'vitest';
import {
  HISTORY_MAX_EVENTS,
  HISTORY_RETENTION_MS,
  TIMELINE_WINDOW_MS,
  appendHistory,
  identityOf,
  sameAccount,
  timelineSegments,
} from '../src/history';
import { EMPTY_RECORD, type AuthRecord, type HistoryEvent } from '../src/types';

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const record = (overrides: Partial<AuthRecord>): AuthRecord => ({ ...EMPTY_RECORD, ...overrides });
const alice = record({ status: 'signed_in', email: 'alice@example.test' });
const bob = record({ status: 'signed_in', email: 'bob@example.test' });
const out = record({ status: 'signed_out' });

group('identityOf', () => {
  it('knows who is signed in from conclusive answers only', () => {
    expect(identityOf(alice)).toEqual({ email: 'alice@example.test' });
    expect(identityOf(out)).toEqual({ email: null });
    expect(identityOf(record({ ...alice, problem: 'email_unavailable' }))).toEqual({ email: 'alice@example.test' });
  });

  it('learns nothing from failed checks, unknown state or a missing email', () => {
    expect(identityOf(record({ ...alice, problem: 'network' }))).toBeUndefined();
    expect(identityOf(record({ ...out, problem: 'challenge' }))).toBeUndefined();
    expect(identityOf(EMPTY_RECORD)).toBeUndefined();
    expect(identityOf(record({ status: 'signed_in', email: null }))).toBeUndefined();
  });
});

group('sameAccount', () => {
  it('ignores case and surrounding spaces', () => {
    expect(sameAccount(' Alice@Example.TEST ', 'alice@example.test')).toBe(true);
    expect(sameAccount('alice@example.test', 'bob@example.test')).toBe(false);
  });

  it('treats signed out as its own state', () => {
    expect(sameAccount(null, null)).toBe(true);
    expect(sameAccount(null, 'alice@example.test')).toBe(false);
  });
});

group('appendHistory', () => {
  it('records each change of account, sign-out included', () => {
    let events: HistoryEvent[] = [];
    events = appendHistory(events, alice, NOW);
    events = appendHistory(events, bob, NOW + 1);
    events = appendHistory(events, out, NOW + 2);
    events = appendHistory(events, alice, NOW + 3);
    expect(events).toEqual([
      { at: NOW, email: 'alice@example.test' },
      { at: NOW + 1, email: 'bob@example.test' },
      { at: NOW + 2, email: null },
      { at: NOW + 3, email: 'alice@example.test' },
    ]);
  });

  it('ignores repeats of the same account, whatever the case', () => {
    const events = appendHistory([{ at: NOW, email: 'alice@example.test' }], record({ ...alice, email: 'ALICE@example.test' }), NOW + 5);
    expect(events).toHaveLength(1);
  });

  it('ignores answers that say nothing new', () => {
    const start: HistoryEvent[] = [{ at: NOW, email: 'alice@example.test' }];
    expect(appendHistory(start, record({ ...bob, problem: 'network' }), NOW + 1)).toEqual(start);
    expect(appendHistory(start, EMPTY_RECORD, NOW + 1)).toEqual(start);
  });

  it('forgets events older than the retention window', () => {
    const old: HistoryEvent = { at: NOW - HISTORY_RETENTION_MS - 1, email: 'alice@example.test' };
    const recent: HistoryEvent = { at: NOW - HOUR, email: 'bob@example.test' };
    expect(appendHistory([old, recent], bob, NOW)).toEqual([recent]);
  });

  it('keeps at most the newest events', () => {
    const many: HistoryEvent[] = Array.from({ length: HISTORY_MAX_EVENTS }, (_, i) => ({
      at: NOW - HISTORY_MAX_EVENTS + i,
      email: i % 2 ? 'alice@example.test' : null,
    }));
    const next = appendHistory(many, bob, NOW);
    expect(next).toHaveLength(HISTORY_MAX_EVENTS);
    expect(next.at(-1)).toEqual({ at: NOW, email: 'bob@example.test' });
    expect(next[0]).toEqual(many[1]);
  });
});

group('timelineSegments', () => {
  it('turns events into segments up to now', () => {
    const events: HistoryEvent[] = [
      { at: NOW - 12 * HOUR, email: 'alice@example.test' },
      { at: NOW - 6 * HOUR, email: null },
    ];
    expect(timelineSegments(events, NOW)).toEqual([
      { start: 0.5, end: 0.75, email: 'alice@example.test', from: NOW - 12 * HOUR, to: NOW - 6 * HOUR },
      { start: 0.75, end: 1, email: null, from: NOW - 6 * HOUR, to: NOW },
    ]);
  });

  it('clips events that started before the window', () => {
    const [segment] = timelineSegments([{ at: NOW - 30 * HOUR, email: 'alice@example.test' }], NOW);
    expect(segment).toMatchObject({ start: 0, end: 1, from: NOW - TIMELINE_WINDOW_MS });
  });

  it('drops segments that ended before the window', () => {
    const events: HistoryEvent[] = [
      { at: NOW - 40 * HOUR, email: 'alice@example.test' },
      { at: NOW - 30 * HOUR, email: 'bob@example.test' },
      { at: NOW - 2 * HOUR, email: null },
    ];
    expect(timelineSegments(events, NOW).map((s) => s.email)).toEqual(['bob@example.test', null]);
  });

  it('leaves time before the first event empty', () => {
    const segments = timelineSegments([{ at: NOW - 3 * HOUR, email: 'alice@example.test' }], NOW);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.start).toBeCloseTo(21 / 24);
  });

  it('sorts events and ignores future ones', () => {
    const events: HistoryEvent[] = [
      { at: NOW + HOUR, email: 'bob@example.test' },
      { at: NOW - 2 * HOUR, email: null },
      { at: NOW - 4 * HOUR, email: 'alice@example.test' },
    ];
    expect(timelineSegments(events, NOW).map((s) => s.email)).toEqual(['alice@example.test', null]);
  });

  it('has nothing to show without events', () => {
    expect(timelineSegments([], NOW)).toEqual([]);
  });
});
