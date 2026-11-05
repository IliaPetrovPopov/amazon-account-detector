import { isBlocked, classifySessionPage } from './classify';
import { accountPageUrl, switcherUrl, type Marketplace } from './marketplaces';
import { EMPTY_RECORD, type AuthRecord, type CheckProblem, type PageResponse } from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Opening the popup or changing marketplace reuses an answer this recent. */
export const FRESH_FOR_MS = 5 * MINUTE;
/** The email is re-read at least this often even when the session has not changed. */
export const EMAIL_REUSE_FOR_MS = 24 * HOUR;
/** After a challenge, automatic checks wait this long. "Check now" still works. */
export const CHALLENGE_BACKOFF_MS = 6 * HOUR;

export interface CheckDeps {
  readAuthCookie(m: Marketplace): Promise<string | null>;
  fetchPage(url: string): Promise<PageResponse>;
  extractEmail(html: string): Promise<string | null>;
  hash(value: string): Promise<string>;
  now(): number;
}

export interface CheckOptions {
  force?: boolean;
}

/**
 * Least disruptive source first:
 * 1. Cookie jar: no network. No auth cookie means signed out, and Amazon is not contacted at all.
 * 2. Account page: confirms the session is alive, because cookies can outlive a server session.
 * 3. Sign-in page: reads the email, only when the session is new or the cached email is old.
 */
export async function checkMarketplace(
  m: Marketplace,
  previous: AuthRecord,
  options: CheckOptions,
  deps: CheckDeps,
): Promise<AuthRecord> {
  const now = deps.now();

  const cookie = await deps.readAuthCookie(m);
  if (!cookie) return signedOut(now);

  const sessionKey = await deps.hash(cookie);
  const sameSession = previous.sessionKey === sessionKey;

  if (!options.force && sameSession) {
    const conclusive = previous.confirmedAt !== null && previous.problem === null;
    if (conclusive && now - previous.confirmedAt! < FRESH_FOR_MS) return previous;
    const backingOff =
      previous.problem === 'challenge' &&
      previous.attemptedAt !== null &&
      now - previous.attemptedAt < CHALLENGE_BACKOFF_MS;
    if (backingOff) return previous;
  }

  // An old answer may only stand in if it describes this same session.
  // After a login or account switch, showing it would name the wrong account.
  const inconclusive = (problem: CheckProblem): AuthRecord =>
    sameSession
      ? { ...previous, attemptedAt: now, problem }
      : { ...EMPTY_RECORD, attemptedAt: now, problem, sessionKey };

  let sessionPage: PageResponse;
  try {
    sessionPage = await deps.fetchPage(accountPageUrl(m));
  } catch {
    return inconclusive('network');
  }

  switch (classifySessionPage(sessionPage)) {
    case 'signed_out':
      // The cookie outlived the session. Keeping its key lets the freshness window apply,
      // so reopening the popup does not ask Amazon again every time.
      return signedOut(now, sessionKey);
    case 'blocked':
      return inconclusive('challenge');
    case 'unrecognised':
      return inconclusive('unrecognised');
    case 'signed_in':
      break;
  }

  const emailStillValid =
    sameSession &&
    previous.email !== null &&
    previous.emailCheckedAt !== null &&
    now - previous.emailCheckedAt < EMAIL_REUSE_FOR_MS;

  const signedIn = (email: string | null, emailCheckedAt: number | null, problem: CheckProblem | null): AuthRecord => ({
    status: 'signed_in',
    email,
    confirmedAt: now,
    attemptedAt: now,
    problem,
    sessionKey,
    emailCheckedAt,
  });

  if (emailStillValid) return signedIn(previous.email, previous.emailCheckedAt, null);

  // The session is confirmed but the email lookup failed: still signed in, and only
  // the previous email of this same session may be shown.
  const withoutNewEmail = (problem: CheckProblem): AuthRecord =>
    sameSession
      ? signedIn(previous.email, previous.emailCheckedAt, problem)
      : signedIn(null, null, problem);

  let signInPage: PageResponse;
  try {
    signInPage = await deps.fetchPage(switcherUrl(m));
  } catch {
    return withoutNewEmail('network');
  }
  if (isBlocked(signInPage)) return withoutNewEmail('challenge');
  if (signInPage.status !== 200) return withoutNewEmail('unrecognised');

  let email: string | null;
  try {
    email = await deps.extractEmail(signInPage.html);
  } catch {
    // The parser failing must not lose the confirmed session.
    return withoutNewEmail('email_unavailable');
  }
  return email ? signedIn(email, now, null) : withoutNewEmail('email_unavailable');
}

function signedOut(now: number, sessionKey: string | null = null): AuthRecord {
  return { ...EMPTY_RECORD, status: 'signed_out', confirmedAt: now, attemptedAt: now, sessionKey };
}
