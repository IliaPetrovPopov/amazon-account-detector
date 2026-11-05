import { JSDOM } from 'jsdom';
import { describe as group, expect, it, vi } from 'vitest';
import { CHALLENGE_BACKOFF_MS, EMAIL_REUSE_FOR_MS, FRESH_FOR_MS, checkMarketplace, type CheckDeps } from '../src/check';
import { readEmail } from '../src/classify';
import { MARKETPLACES, accountPageUrl, switcherUrl } from '../src/marketplaces';
import { EMPTY_RECORD, type AuthRecord, type PageResponse } from '../src/types';
import {
  EMPTY_SIGN_IN_PAGE,
  SIGNED_IN_ACCOUNT_PAGE,
  SIGNED_OUT_ACCOUNT_PAGE,
  WAF_CHALLENGE,
  page,
  signInPrompt,
} from './fixtures';

const de = MARKETPLACES.de;
const ACCOUNT_URL = accountPageUrl(de);
const SWITCHER_URL = switcherUrl(de);
const NOW = 1_000_000_000;

const challenge = page(WAF_CHALLENGE, { status: 202, wafAction: 'challenge' });
const signedInPage = page(SIGNED_IN_ACCOUNT_PAGE);
const prompt = page(signInPrompt('user@example.com'));

/** Each URL maps to a response, or to an Error for a network failure. */
function makeDeps(cookie: string | null, pages: Record<string, PageResponse | Error> = {}) {
  const fetchPage = vi.fn(async (url: string) => {
    const response = pages[url];
    if (!response) throw new Error(`Unexpected fetch: ${url}`);
    if (response instanceof Error) throw response;
    return response;
  });
  const deps: CheckDeps = {
    readAuthCookie: async () => cookie,
    fetchPage,
    extractEmail: async (html) => readEmail(new JSDOM(html).window.document),
    hash: async (value) => `hash:${value}`,
    now: () => NOW,
  };
  return { deps, fetchPage };
}

const confirmed = (overrides: Partial<AuthRecord> = {}): AuthRecord => ({
  status: 'signed_in',
  email: 'old@example.com',
  confirmedAt: NOW - 60 * 60_000,
  attemptedAt: NOW - 60 * 60_000,
  problem: null,
  sessionKey: 'hash:session',
  emailCheckedAt: NOW - 60 * 60_000,
  ...overrides,
});

group('no auth cookie', () => {
  it('answers signed out without touching the network', async () => {
    const { deps, fetchPage } = makeDeps(null);
    const result = await checkMarketplace(de, confirmed(), {}, deps);
    expect(result.status).toBe('signed_out');
    expect(result.email).toBeNull();
    expect(result.confirmedAt).toBe(NOW);
    expect(fetchPage).not.toHaveBeenCalled();
  });
});

group('signed in', () => {
  it('reads the email on a new session', async () => {
    const { deps, fetchPage } = makeDeps('session', { [ACCOUNT_URL]: signedInPage, [SWITCHER_URL]: prompt });
    const result = await checkMarketplace(de, EMPTY_RECORD, {}, deps);
    expect(result).toEqual({
      status: 'signed_in',
      email: 'user@example.com',
      confirmedAt: NOW,
      attemptedAt: NOW,
      problem: null,
      sessionKey: 'hash:session',
      emailCheckedAt: NOW,
    });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('does not contact Amazon while the answer is fresh', async () => {
    const { deps, fetchPage } = makeDeps('session');
    const previous = confirmed({ confirmedAt: NOW - FRESH_FOR_MS + 1 });
    expect(await checkMarketplace(de, previous, {}, deps)).toBe(previous);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('verifies the session again once the answer is no longer fresh', async () => {
    const { deps, fetchPage } = makeDeps('session', { [ACCOUNT_URL]: signedInPage });
    const result = await checkMarketplace(de, confirmed({ confirmedAt: NOW - FRESH_FOR_MS }), {}, deps);
    expect(result.confirmedAt).toBe(NOW);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('keeps the sign-in page out of routine checks while the session is unchanged', async () => {
    const { deps, fetchPage } = makeDeps('session', { [ACCOUNT_URL]: signedInPage });
    const result = await checkMarketplace(de, confirmed(), { force: true }, deps);
    expect(result.email).toBe('old@example.com');
    expect(result.confirmedAt).toBe(NOW);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(ACCOUNT_URL);
  });

  it('reads the email again after a login or account switch, even if the answer was fresh', async () => {
    const { deps, fetchPage } = makeDeps('new-session', { [ACCOUNT_URL]: signedInPage, [SWITCHER_URL]: prompt });
    const previous = confirmed({ confirmedAt: NOW - 1 });
    const result = await checkMarketplace(de, previous, {}, deps);
    expect(result.email).toBe('user@example.com');
    expect(result.sessionKey).toBe('hash:new-session');
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('reads the email again once the cached one is old', async () => {
    const { deps } = makeDeps('session', { [ACCOUNT_URL]: signedInPage, [SWITCHER_URL]: prompt });
    const result = await checkMarketplace(de, confirmed({ emailCheckedAt: NOW - EMAIL_REUSE_FOR_MS }), {}, deps);
    expect(result.email).toBe('user@example.com');
    expect(result.emailCheckedAt).toBe(NOW);
  });
});

group('session gone while cookies remain', () => {
  it('reports signed out and drops the email', async () => {
    const { deps } = makeDeps('session', { [ACCOUNT_URL]: page(SIGNED_OUT_ACCOUNT_PAGE) });
    const result = await checkMarketplace(de, confirmed(), {}, deps);
    expect(result.status).toBe('signed_out');
    expect(result.email).toBeNull();
    expect(result.sessionKey).toBe('hash:session');
  });

  it('does not ask Amazon again about a dead session while the answer is fresh', async () => {
    const { deps, fetchPage } = makeDeps('session');
    const previous: AuthRecord = {
      ...EMPTY_RECORD,
      status: 'signed_out',
      confirmedAt: NOW - 60_000,
      attemptedAt: NOW - 60_000,
      sessionKey: 'hash:session',
    };
    expect(await checkMarketplace(de, previous, {}, deps)).toBe(previous);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('notices a new login after a dead session, because the cookie changes', async () => {
    const { deps } = makeDeps('new-session', { [ACCOUNT_URL]: signedInPage, [SWITCHER_URL]: prompt });
    const previous: AuthRecord = {
      ...EMPTY_RECORD,
      status: 'signed_out',
      confirmedAt: NOW - 60_000,
      attemptedAt: NOW - 60_000,
      sessionKey: 'hash:session',
    };
    const result = await checkMarketplace(de, previous, {}, deps);
    expect(result.status).toBe('signed_in');
    expect(result.email).toBe('user@example.com');
  });

  it('never takes the email prompt as proof, because the session check comes first', async () => {
    const { deps, fetchPage } = makeDeps('session', {
      [ACCOUNT_URL]: page(EMPTY_SIGN_IN_PAGE, { finalUrl: 'https://www.amazon.de/ap/signin?x=1' }),
      [SWITCHER_URL]: prompt,
    });
    const result = await checkMarketplace(de, confirmed(), {}, deps);
    expect(result.status).toBe('signed_out');
    expect(result.email).toBeNull();
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

group('inconclusive checks never become signed out', () => {
  it('keeps the last known answer on a network failure', async () => {
    const { deps } = makeDeps('session', { [ACCOUNT_URL]: new Error('offline') });
    const previous = confirmed();
    const result = await checkMarketplace(de, previous, {}, deps);
    expect(result).toEqual({ ...previous, attemptedAt: NOW, problem: 'network' });
  });

  it('keeps the last known answer on a challenge, without updating confirmedAt', async () => {
    const { deps } = makeDeps('session', { [ACCOUNT_URL]: challenge });
    const previous = confirmed();
    const result = await checkMarketplace(de, previous, {}, deps);
    expect(result.status).toBe('signed_in');
    expect(result.confirmedAt).toBe(previous.confirmedAt);
    expect(result.problem).toBe('challenge');
  });

  it('keeps the last known answer on an unrecognised page', async () => {
    const { deps } = makeDeps('session', { [ACCOUNT_URL]: page('<html></html>') });
    const result = await checkMarketplace(de, confirmed(), {}, deps);
    expect(result.status).toBe('signed_in');
    expect(result.problem).toBe('unrecognised');
  });

  it('never shows the old email when the session changed and the check failed', async () => {
    const { deps } = makeDeps('new-session', { [ACCOUNT_URL]: challenge });
    const result = await checkMarketplace(de, confirmed(), {}, deps);
    expect(result.status).toBe('unknown');
    expect(result.email).toBeNull();
    expect(result.problem).toBe('challenge');
  });
});

group('session confirmed but email lookup fails', () => {
  it('reports signed in without an email on a new session', async () => {
    const { deps } = makeDeps('new-session', { [ACCOUNT_URL]: signedInPage, [SWITCHER_URL]: challenge });
    const result = await checkMarketplace(de, confirmed(), {}, deps);
    expect(result.status).toBe('signed_in');
    expect(result.email).toBeNull();
    expect(result.problem).toBe('challenge');
  });

  it('keeps the email of the same session', async () => {
    const { deps } = makeDeps('session', { [ACCOUNT_URL]: signedInPage, [SWITCHER_URL]: new Error('offline') });
    const result = await checkMarketplace(de, confirmed({ emailCheckedAt: NOW - EMAIL_REUSE_FOR_MS }), {}, deps);
    expect(result.status).toBe('signed_in');
    expect(result.email).toBe('old@example.com');
    expect(result.problem).toBe('network');
  });

  it('keeps the confirmed session when the parser fails', async () => {
    const { deps } = makeDeps('new-session', { [ACCOUNT_URL]: signedInPage, [SWITCHER_URL]: prompt });
    deps.extractEmail = async () => {
      throw new Error('offscreen document unavailable');
    };
    const result = await checkMarketplace(de, EMPTY_RECORD, {}, deps);
    expect(result.status).toBe('signed_in');
    expect(result.email).toBeNull();
    expect(result.problem).toBe('email_unavailable');
  });

  it('says so when the page shows no email', async () => {
    const { deps } = makeDeps('new-session', { [ACCOUNT_URL]: signedInPage, [SWITCHER_URL]: page(EMPTY_SIGN_IN_PAGE) });
    const result = await checkMarketplace(de, EMPTY_RECORD, {}, deps);
    expect(result.status).toBe('signed_in');
    expect(result.email).toBeNull();
    expect(result.problem).toBe('email_unavailable');
  });
});

group('challenge backoff', () => {
  const challenged = () => confirmed({ problem: 'challenge', attemptedAt: NOW - CHALLENGE_BACKOFF_MS + 1 });

  it('holds automatic checks after a challenge', async () => {
    const { deps, fetchPage } = makeDeps('session');
    const previous = challenged();
    expect(await checkMarketplace(de, previous, {}, deps)).toBe(previous);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('lets "Check now" through', async () => {
    const { deps, fetchPage } = makeDeps('session', { [ACCOUNT_URL]: signedInPage });
    const result = await checkMarketplace(de, challenged(), { force: true }, deps);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.problem).toBeNull();
  });

  it('checks again once the backoff has passed', async () => {
    const { deps, fetchPage } = makeDeps('session', { [ACCOUNT_URL]: signedInPage });
    await checkMarketplace(de, confirmed({ problem: 'challenge', attemptedAt: NOW - CHALLENGE_BACKOFF_MS }), {}, deps);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('does not hold a new session', async () => {
    const { deps, fetchPage } = makeDeps('new-session', { [ACCOUNT_URL]: signedInPage, [SWITCHER_URL]: prompt });
    await checkMarketplace(de, challenged(), {}, deps);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
