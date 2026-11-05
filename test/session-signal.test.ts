import { describe as group, expect, it } from 'vitest';
import { sessionSignal } from '../src/session-signal';

const change = (name: string, removed: boolean, cause: string) => ({ removed, cause, cookie: { name } });

// Sequences recorded from real Amazon logins, account switches and sign-outs.
group('sessionSignal', () => {
  it('ignores the first half of a rewrite, which would otherwise look like a logout', () => {
    expect(sessionSignal(change('at-acbde', true, 'overwrite'))).toBeNull();
  });

  it('sees the new value of a login or account switch', () => {
    expect(sessionSignal(change('at-acbde', false, 'explicit'))).toBe('de');
  });

  it('sees a real sign-out', () => {
    expect(sessionSignal(change('at-main', true, 'expired_overwrite'))).toBe('com');
  });

  it('sees a cookie that expired', () => {
    expect(sessionSignal(change('at-acbfr', true, 'expired'))).toBe('fr');
  });

  it('ignores cookies that change on ordinary page loads', () => {
    for (const name of ['x-main', 'session-token', 'session-id', 'ubid-main', 'sst-main']) {
      expect(sessionSignal(change(name, false, 'explicit'))).toBeNull();
      expect(sessionSignal(change(name, true, 'overwrite'))).toBeNull();
    }
  });
});
