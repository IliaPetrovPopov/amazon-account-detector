import { describe as group, expect, it } from 'vitest';
import { MARKETPLACES } from '../src/marketplaces';
import { EMPTY_RECORD, type AuthRecord } from '../src/types';
import {
  STALE_AFTER_MS,
  badgeView,
  boardRow,
  boardSummary,
  changeNote,
  clockTime,
  describe,
  emailLines,
  formatAge,
  heroText,
  isLastKnown,
  lookOf,
} from '../src/view';

const de = MARKETPLACES.de;
const NOW = new Date(2026, 10, 5, 14, 30, 0).getTime();
const MINUTE = 60_000;

const record = (overrides: Partial<AuthRecord>): AuthRecord => ({ ...EMPTY_RECORD, ...overrides });
const signedIn = (overrides: Partial<AuthRecord> = {}) =>
  record({ status: 'signed_in', email: 'user@example.com', confirmedAt: NOW - 2 * MINUTE, ...overrides });
const signedOut = (overrides: Partial<AuthRecord> = {}) =>
  record({ status: 'signed_out', confirmedAt: NOW - MINUTE, ...overrides });

group('formatAge', () => {
  it.each([
    [59_000, 'just now'],
    [MINUTE, '1 min ago'],
    [59 * MINUTE, '59 min ago'],
    [60 * MINUTE, '1 hour ago'],
    [120 * MINUTE, '2 hours ago'],
    [24 * 60 * MINUTE, '1 day ago'],
    [72 * 60 * MINUTE, '3 days ago'],
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatAge(ms)).toBe(expected);
  });
});

group('clockTime', () => {
  it('uses a zero-padded 24-hour clock', () => {
    expect(clockTime(new Date(2026, 0, 1, 9, 5).getTime())).toBe('09:05');
    expect(clockTime(new Date(2026, 0, 1, 23, 59).getTime())).toBe('23:59');
    expect(clockTime(new Date(2026, 0, 1, 0, 0).getTime())).toBe('00:00');
  });
});

group('isLastKnown', () => {
  it('is current right up to the stale threshold', () => {
    expect(isLastKnown(signedIn({ confirmedAt: NOW - STALE_AFTER_MS }), NOW)).toBe(false);
    expect(isLastKnown(signedIn({ confirmedAt: NOW - STALE_AFTER_MS - 1 }), NOW)).toBe(true);
  });

  it('is not current after any failed check, except a missing email', () => {
    for (const problem of ['network', 'challenge', 'unrecognised'] as const) {
      expect(isLastKnown(signedIn({ problem }), NOW)).toBe(true);
    }
    expect(isLastKnown(signedIn({ problem: 'email_unavailable' }), NOW)).toBe(false);
  });

  it('never checked is not "last known"', () => {
    expect(isLastKnown(EMPTY_RECORD, NOW)).toBe(false);
  });
});

group('describe', () => {
  it('shows a confirmed signed-in account', () => {
    const view = describe(signedIn(), de, NOW, false);
    expect(view).toMatchObject({
      tone: 'ok',
      status: 'Signed in',
      headline: 'Signed in',
      account: 'user@example.com',
      accountMuted: false,
      notice: null,
      freshness: 'Checked 2 min ago',
      time: '14:28',
      action: null,
      pin: { state: 'none', email: null },
    });
  });

  it('labels an old answer as last known, not current', () => {
    const view = describe(signedIn({ confirmedAt: NOW - STALE_AFTER_MS - 1 }), de, NOW, false);
    expect(view).toMatchObject({
      tone: 'warn',
      status: 'Last known',
      headline: 'Last known: signed in',
      accountMuted: true,
      freshness: 'Last confirmed 1 hour ago',
    });
  });

  it('labels the answer as last known when the latest check failed, however recent it was', () => {
    const view = describe(signedIn({ problem: 'network' }), de, NOW, false);
    expect(view.headline).toBe('Last known: signed in');
    expect(view.accountMuted).toBe(true);
    expect(view.notice).toContain('Could not reach Amazon');
    expect(view.freshness).toBe('Last confirmed 2 min ago');
  });

  it('offers a way through a challenge', () => {
    const view = describe(signedIn({ problem: 'challenge' }), de, NOW, false);
    expect(view.notice).toContain('Open amazon.de once');
    expect(view.action).toEqual({ label: 'Open amazon.de', url: 'https://www.amazon.de/', primary: false });
  });

  it('explains an unrecognised page', () => {
    expect(describe(signedIn({ problem: 'unrecognised' }), de, NOW, false).notice).toContain('does not recognise');
  });

  it('shows no email when signed out, and offers sign-in', () => {
    const view = describe(signedOut({ confirmedAt: NOW }), de, NOW, false);
    expect(view.headline).toBe('Not signed in');
    expect(view.status).toBe('Signed out');
    expect(view.account).toBeNull();
    expect(view.action?.label).toBe('Sign in on amazon.de');
    expect(view.action?.primary).toBe(true);
    expect(view.action?.url).toContain('https://www.amazon.de/ap/signin');
  });

  it('marks an old signed-out answer as last known', () => {
    const view = describe(signedOut({ confirmedAt: NOW - STALE_AFTER_MS - 1 }), de, NOW, false);
    expect(view.headline).toBe('Last known: not signed in');
    expect(view.tone).toBe('warn');
  });

  it('stays honest when signed in but the email is missing', () => {
    const view = describe(signedIn({ email: null, problem: 'email_unavailable' }), de, NOW, false);
    expect(view.headline).toBe('Signed in');
    expect(view.account).toBe('Email not available');
    expect(view.accountMuted).toBe(true);
  });

  it('separates never checked from a failed first check', () => {
    expect(describe(EMPTY_RECORD, de, NOW, false).headline).toBe('Not checked yet');
    expect(describe(EMPTY_RECORD, de, NOW, false).status).toBe('Not checked');
    expect(describe(EMPTY_RECORD, de, NOW, false).time).toBeNull();
    const failed = describe(record({ problem: 'network' }), de, NOW, false);
    expect(failed.headline).toBe('Could not check');
    expect(failed.status).toBe('No answer');
    expect(failed.tone).toBe('warn');
  });

  it('keeps the cached account visible while checking', () => {
    const view = describe(signedIn(), de, NOW, true);
    expect(view.account).toBe('user@example.com');
    expect(view.freshness).toBe('Checking…');
  });

  it('confirms a pinned account that matches, ignoring case and spaces', () => {
    const view = describe(signedIn(), de, NOW, false, ' User@Example.com ');
    expect(view.pin.state).toBe('match');
    expect(view.tone).toBe('ok');
    expect(view.headline).toBe('Signed in');
  });

  it('raises the alarm for the wrong account and offers the switcher', () => {
    const view = describe(signedIn(), de, NOW, false, 'other@example.com');
    expect(view).toMatchObject({
      tone: 'alert',
      status: 'Wrong account',
      headline: 'Wrong account',
      account: 'user@example.com',
      pin: { state: 'mismatch', email: 'other@example.com' },
    });
    expect(view.action).toMatchObject({ label: 'Switch account', primary: true });
    expect(view.action?.url).toContain('https://www.amazon.de/ap/signin');
  });

  it('keeps the wrong-account alarm when the answer is old, but says so', () => {
    const view = describe(signedIn({ confirmedAt: NOW - STALE_AFTER_MS - 1 }), de, NOW, false, 'other@example.com');
    expect(view.tone).toBe('alert');
    expect(view.headline).toBe('Last known: wrong account');
  });

  it('a pin means nothing while signed out', () => {
    const view = describe(signedOut(), de, NOW, false, 'other@example.com');
    expect(view.pin.state).toBe('none');
    expect(view.tone).toBe('off');
  });
});

group('boardRow', () => {
  it('describes every state in a few words', () => {
    expect(boardRow(signedIn(), de, NOW).status).toBe('Signed in');
    expect(boardRow(signedIn({ problem: 'challenge' }), de, NOW).status).toBe('Last known');
    expect(boardRow(signedOut(), de, NOW).status).toBe('Signed out');
    expect(boardRow(signedOut({ problem: 'network' }), de, NOW).status).toBe('Last known');
    expect(boardRow(EMPTY_RECORD, de, NOW).status).toBe('Not checked');
    expect(boardRow(record({ problem: 'network' }), de, NOW).status).toBe('No answer');
    expect(boardRow(signedIn(), de, NOW, 'other@example.com').status).toBe('Wrong account');
  });

  it('shows the account only while signed in', () => {
    expect(boardRow(signedIn(), de, NOW).account).toBe('user@example.com');
    expect(boardRow(signedOut(), de, NOW).account).toBe('');
    expect(boardRow(signedIn({ email: null }), de, NOW).account).toBe('');
  });

  it('carries the code, the country, the domain, the times and the pin', () => {
    const row = boardRow(signedIn(), de, NOW, 'user@example.com');
    expect(row).toMatchObject({
      id: 'de',
      code: 'DE',
      country: 'Germany',
      domain: 'amazon.de',
      time: '14:28',
      freshness: 'Checked 2 min ago',
      pin: 'user@example.com',
      pinState: 'match',
      dim: false,
    });
    expect(boardRow(signedIn(), de, NOW, 'other@example.com').pinState).toBe('mismatch');
    expect(boardRow(EMPTY_RECORD, de, NOW)).toMatchObject({ time: null, pin: null, pinState: 'none', freshness: '' });
  });

  it('reads as one sentence for screen readers', () => {
    expect(boardRow(signedIn(), de, NOW).label).toBe('amazon.de, Signed in, user@example.com, Checked 2 min ago');
    expect(boardRow(signedIn(), de, NOW, 'other@example.com').label).toBe(
      'amazon.de, Wrong account, user@example.com, pinned account is other@example.com, Checked 2 min ago',
    );
    expect(boardRow(EMPTY_RECORD, de, NOW).label).toBe('amazon.de, Not checked yet');
  });

  it('dims answers that are not current', () => {
    expect(boardRow(signedIn({ confirmedAt: NOW - STALE_AFTER_MS - 1 }), de, NOW).dim).toBe(true);
  });
});

group('boardSummary', () => {
  it('counts signed-in marketplaces', () => {
    expect(boardSummary([signedIn(), signedOut(), EMPTY_RECORD, signedIn(), signedOut()])).toBe(
      '2 of 5 marketplaces signed in',
    );
    expect(boardSummary([EMPTY_RECORD, EMPTY_RECORD])).toBe('0 of 2 marketplaces signed in');
  });

  it('adds the marketplaces on the wrong account', () => {
    const records = [signedIn(), signedIn(), signedOut()];
    expect(boardSummary(records, ['other@example.com', 'user@example.com', 'other@example.com'])).toBe(
      '2 of 3 marketplaces signed in, 1 on the wrong account',
    );
    expect(boardSummary(records, [null, null, null])).toBe('2 of 3 marketplaces signed in');
  });
});

group('heroText', () => {
  it('leads with the part of the email that tells accounts apart', () => {
    expect(heroText(signedIn({ email: 'alice.lindqvist@example.com' }), de)).toEqual({
      primary: 'alice.lindqvist',
      secondary: '@example.com',
      email: 'alice.lindqvist@example.com',
    });
  });

  it('shows a phone-number account on one line, with the marketplace under it', () => {
    expect(heroText(signedIn({ email: '+44 7700 900123' }), de)).toEqual({
      primary: '+44 7700 900123',
      secondary: 'amazon.de',
      email: '+44 7700 900123',
    });
  });

  it('names the state when there is no account to show', () => {
    expect(heroText(signedIn({ email: null }), de)).toMatchObject({ primary: 'Signed in', email: null });
    expect(heroText(signedOut(), de)).toEqual({ primary: 'Not signed in', secondary: 'amazon.de', email: null });
    expect(heroText(EMPTY_RECORD, de).primary).toBe('Not checked yet');
    expect(heroText(record({ problem: 'network' }), de).primary).toBe('No answer from Amazon');
  });
});

group('changeNote', () => {
  it('remembers who was signed in, or that nobody was', () => {
    expect(lookOf(signedIn())).toEqual({ email: 'user@example.com' });
    expect(lookOf(signedOut())).toEqual({ email: null });
    expect(lookOf(EMPTY_RECORD)).toBeNull();
    expect(lookOf(signedIn({ problem: 'network' }))).toBeNull();
  });

  it('says nothing on a first look or when nothing changed', () => {
    expect(changeNote(undefined, signedIn())).toBeNull();
    expect(changeNote({ email: 'USER@example.com ' }, signedIn())).toBeNull();
    expect(changeNote({ email: null }, signedOut())).toBeNull();
  });

  it('says nothing when the latest answer is not conclusive', () => {
    expect(changeNote({ email: 'old@example.com' }, signedIn({ problem: 'challenge' }))).toBeNull();
  });

  it('names the account that was signed in before', () => {
    expect(changeNote({ email: 'old@example.com' }, signedIn())).toEqual({
      text: 'Account changed since you last looked',
      before: 'old@example.com',
    });
    expect(changeNote({ email: 'old@example.com' }, signedOut())).toEqual({
      text: 'Signed out since you last looked',
      before: 'old@example.com',
    });
    expect(changeNote({ email: null }, signedIn())).toEqual({ text: 'Signed in since you last looked', before: null });
  });
});

group('badgeView', () => {
  it('shows the region code coloured by state', () => {
    expect(badgeView(signedIn(), de, NOW)).toMatchObject({ text: 'DE', color: '#16A34A', textColor: '#FFFFFF' });
    expect(badgeView(signedOut(), de, NOW).color).toBe('#5B6B86');
    expect(badgeView(signedIn({ problem: 'network' }), de, NOW)).toMatchObject({ color: '#F5C24B', textColor: '#16203B' });
    expect(badgeView(signedIn(), de, NOW, 'other@example.com').color).toBe('#DC2626');
  });

  it('names the account and any pin in the tooltip', () => {
    expect(badgeView(signedIn(), de, NOW).title).toBe('Amazon Account Detector\namazon.de: Signed in as user@example.com');
    expect(badgeView(signedIn(), de, NOW, 'other@example.com').title).toBe(
      'Amazon Account Detector\namazon.de: Wrong account as user@example.com\nPinned account: other@example.com',
    );
    expect(badgeView(signedOut(), de, NOW).title).toBe('Amazon Account Detector\namazon.de: Not signed in');
  });
});

group('emailLines', () => {
  it('splits at the last @', () => {
    expect(emailLines('alice.johnson@example.com')).toEqual(['alice.johnson', '@example.com']);
    expect(emailLines('"odd@local"@example.com')).toEqual(['"odd@local"', '@example.com']);
  });

  it('keeps identifiers without an @ on one line', () => {
    expect(emailLines('+44 7700 900123')).toEqual(['+44 7700 900123', '']);
    expect(emailLines('@example.com')).toEqual(['@example.com', '']);
  });
});
