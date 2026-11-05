import { marketplaceForAuthCookie, type MarketplaceId } from './marketplaces';

export interface CookieChange {
  removed: boolean;
  cause: string;
  cookie: { name: string };
}

/**
 * Tells which marketplace's session a cookie change affects, if any.
 * Chrome reports a rewrite as two events: removed with cause 'overwrite', then the new value.
 * Only the second counts. A real sign-out arrives as removed with cause 'expired_overwrite'.
 */
export function sessionSignal(change: CookieChange): MarketplaceId | null {
  const marketplace = marketplaceForAuthCookie(change.cookie.name);
  if (!marketplace) return null;
  if (change.removed && change.cause === 'overwrite') return null;
  return marketplace.id;
}
