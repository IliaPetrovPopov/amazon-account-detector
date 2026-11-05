import { describe as group, expect, it } from 'vitest';
import { TEST_ALERT_ID, alertFor, alertId, marketplaceOfAlert } from '../src/alerts';
import { MARKETPLACES } from '../src/marketplaces';
import { EMPTY_RECORD, type AuthRecord } from '../src/types';

const de = MARKETPLACES.de;
const record = (overrides: Partial<AuthRecord>): AuthRecord => ({ ...EMPTY_RECORD, confirmedAt: 1, ...overrides });
const signedIn = (email: string | null, overrides: Partial<AuthRecord> = {}) => record({ status: 'signed_in', email, ...overrides });
const signedOut = record({ status: 'signed_out' });
const names = { 'alice@example.test': 'Main buyer' };

group('alertFor: signing out', () => {
  it('alerts when a signed-in marketplace signs out, naming the account by nickname and email', () => {
    expect(alertFor(de, signedIn('alice@example.test'), signedOut, null, names)).toEqual({
      title: 'Signed out on amazon.de',
      message: 'Main buyer (alice@example.test) is no longer signed in. Click to sign in again.',
    });
  });

  it('still alerts when Amazon never showed the email', () => {
    expect(alertFor(de, signedIn(null), signedOut, null, {})?.message).toBe('The account is no longer signed in. Click to sign in again.');
  });

  it('stays quiet when nothing changed or nobody was signed in', () => {
    expect(alertFor(de, signedOut, signedOut, null, {})).toBeNull();
    expect(alertFor(de, EMPTY_RECORD, signedOut, null, {})).toBeNull();
    expect(alertFor(de, signedIn('alice@example.test'), signedIn('alice@example.test', { confirmedAt: 2 }), null, {})).toBeNull();
  });

  it('never alerts on a failed check: that is not news about the session', () => {
    const failed = signedIn('alice@example.test', { problem: 'network' });
    expect(alertFor(de, signedIn('alice@example.test'), failed, null, {})).toBeNull();
    expect(alertFor(de, signedIn('alice@example.test'), { ...signedOut, problem: 'challenge' }, null, {})).toBeNull();
  });

  it('alerts when an answer that was no longer current turns out signed out', () => {
    const lastKnown = signedIn('alice@example.test', { problem: 'network' });
    expect(alertFor(de, lastKnown, signedOut, null, {})?.title).toBe('Signed out on amazon.de');
  });
});

group('alertFor: the wrong account', () => {
  it('alerts when another account than the pinned one signs in', () => {
    expect(alertFor(de, signedIn('alice@example.test'), signedIn('bob@example.test'), 'alice@example.test', names)).toEqual({
      title: 'Wrong account on amazon.de',
      message: 'bob@example.test is signed in, not Main buyer (alice@example.test). Click to switch accounts.',
    });
    expect(alertFor(de, signedOut, signedIn('bob@example.test'), 'alice@example.test', {})?.title).toBe('Wrong account on amazon.de');
  });

  it('alerts once: a refresh of the same wrong account stays quiet', () => {
    expect(alertFor(de, signedIn('bob@example.test'), signedIn('BOB@example.test', { confirmedAt: 2 }), 'alice@example.test', {})).toBeNull();
  });

  it('stays quiet for the pinned account, with no pin, or without an email to compare', () => {
    expect(alertFor(de, signedOut, signedIn('Alice@Example.test'), 'alice@example.test', {})).toBeNull();
    expect(alertFor(de, signedOut, signedIn('bob@example.test'), null, {})).toBeNull();
    expect(alertFor(de, signedOut, signedIn(null, { problem: 'email_unavailable' }), 'alice@example.test', {})).toBeNull();
  });
});

group('alert ids', () => {
  it('give each marketplace one notification, and lead back to it', () => {
    expect(alertId(de)).toBe('alert:de');
    expect(marketplaceOfAlert('alert:co.uk')).toBe('co.uk');
    expect(marketplaceOfAlert(TEST_ALERT_ID)).toBeNull();
    expect(marketplaceOfAlert('something:de')).toBeNull();
  });
});
