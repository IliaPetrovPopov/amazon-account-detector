import type { PageResponse } from './types';

export type SessionVerdict = 'signed_in' | 'signed_out' | 'blocked' | 'unrecognised';

// Amazon's sites answer bots in several ways: 202 with an AWS WAF script, 403, or a small
// 200 page. None of these say anything about the session, and response.ok is true for 202.
const BLOCKING_STATUSES = new Set([202, 403, 429, 503]);
const CHALLENGE_MARKERS = /gokuProps|AwsWafIntegration|validateCaptcha|opfcaptcha|captchacharacters/i;
const CHALLENGE_PATHS = /^\/(?:(?:ap|ax)\/cvf|errors\/validateCaptcha)/;
const SIGN_IN_PATHS = /^\/(?:ap\/signin|ax\/claim)/;

const CUSTOMER_NAME = /config\.customerName['"]?\s*,\s*(false|null|["'])/;
const SIGNED_IN_NAV_REF = 'nav_youraccount_btn';
const SIGNED_OUT_NAV_REF = 'nav_ya_signin';

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export function isBlocked(page: PageResponse): boolean {
  return (
    page.wafAction !== null ||
    BLOCKING_STATUSES.has(page.status) ||
    CHALLENGE_PATHS.test(pathOf(page.finalUrl)) ||
    CHALLENGE_MARKERS.test(page.html)
  );
}

/**
 * Decides from positive evidence only. The markers are language independent, and both must
 * agree. Anything else is 'unrecognised', so a changed or unexpected page can never be read
 * as a logout.
 */
export function classifySessionPage(page: PageResponse): SessionVerdict {
  if (isBlocked(page)) return 'blocked';
  if (page.status !== 200) return 'unrecognised';
  // The account page sent us to sign in, so this session can no longer open it.
  if (SIGN_IN_PATHS.test(pathOf(page.finalUrl))) return 'signed_out';

  const customerName = page.html.match(CUSTOMER_NAME)?.[1];
  const hasSignedInRef = page.html.includes(SIGNED_IN_NAV_REF);
  const hasSignedOutRef = page.html.includes(SIGNED_OUT_NAV_REF);
  const nameIsEmpty = customerName === 'false' || customerName === 'null';

  if (customerName && !nameIsEmpty && hasSignedInRef && !hasSignedOutRef) return 'signed_in';
  if (nameIsEmpty && hasSignedOutRef && !hasSignedInRef) return 'signed_out';
  return 'unrecognised';
}

/** Reads the active account from the sign-in prompt. Ids and attributes, so language does not matter. */
export function readEmail(doc: Document): string | null {
  const fromClaim = doc.querySelector<HTMLInputElement>('input#ap-claim')?.getAttribute('value')?.trim();
  const fromHint = doc.querySelector('[data-claim]')?.getAttribute('data-claim')?.trim();
  return fromClaim || fromHint || null;
}
