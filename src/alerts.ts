import { sameAccount } from './history';
import { accountLabel, pinState, type AccountNames } from './identity';
import { isMarketplaceId, type Marketplace, type MarketplaceId } from './marketplaces';
import type { AuthRecord } from './types';

// Desktop alerts, off until the person turns them on in Settings. Each marketplace has one
// notification id, so a new alert replaces the previous one instead of piling up.

export interface AccountAlert {
  title: string;
  message: string;
}

export const TEST_ALERT_ID = 'alert:test';

export const alertId = (m: Marketplace): string => `alert:${m.id}`;

/** The marketplace an alert is about, or null for the test alert and anything else. */
export function marketplaceOfAlert(notificationId: string): MarketplaceId | null {
  const id = notificationId.startsWith('alert:') ? notificationId.slice('alert:'.length) : null;
  return isMarketplaceId(id) ? id : null;
}

/**
 * What to tell the person after a new answer, if anything: a marketplace that was signed in and
 * now is not, or an account other than the pinned one that just signed in. Only a change alerts,
 * so a routine refresh of the same answer stays quiet, and a failed check is never news.
 */
export function alertFor(
  m: Marketplace,
  previous: AuthRecord,
  next: AuthRecord,
  pin: string | null,
  names: AccountNames,
): AccountAlert | null {
  if (next.problem !== null && next.problem !== 'email_unavailable') return null;

  if (previous.status === 'signed_in' && next.status === 'signed_out') {
    const who = previous.email ? accountLabel(names, previous.email) : 'The account';
    return { title: `Signed out on ${m.domain}`, message: `${who} is no longer signed in. Click to sign in again.` };
  }

  if (next.status === 'signed_in' && next.email && pin && pinState(pin, next.email) === 'mismatch') {
    const sameAsBefore = previous.status === 'signed_in' && sameAccount(previous.email, next.email);
    if (sameAsBefore) return null;
    return {
      title: `Wrong account on ${m.domain}`,
      message: `${accountLabel(names, next.email)} is signed in, not ${accountLabel(names, pin)}. Click to switch accounts.`,
    };
  }

  return null;
}
