export const MARKETPLACE_IDS = ['com', 'co.uk', 'de', 'it', 'fr'] as const;
export type MarketplaceId = (typeof MARKETPLACE_IDS)[number];

export interface Marketplace {
  id: MarketplaceId;
  /** Two-letter region code, shown on the board and the toolbar badge. */
  code: string;
  label: string;
  domain: string;
  /** Value for openid.assoc_handle. `usflex` returns 404 on every site except amazon.com. */
  assocHandle: string;
  /**
   * Exists only while signed in, and changes only on login or account switch.
   * Other Amazon cookies are no use here: sst-* and ubid-* also exist for anonymous
   * visitors, and x-* rewrites itself on ordinary page loads.
   */
  authCookie: string;
}

export const MARKETPLACES: Record<MarketplaceId, Marketplace> = {
  com: { id: 'com', code: 'US', label: 'United States', domain: 'amazon.com', assocHandle: 'usflex', authCookie: 'at-main' },
  'co.uk': { id: 'co.uk', code: 'UK', label: 'United Kingdom', domain: 'amazon.co.uk', assocHandle: 'gbflex', authCookie: 'at-acbuk' },
  de: { id: 'de', code: 'DE', label: 'Germany', domain: 'amazon.de', assocHandle: 'deflex', authCookie: 'at-acbde' },
  it: { id: 'it', code: 'IT', label: 'Italy', domain: 'amazon.it', assocHandle: 'itflex', authCookie: 'at-acbit' },
  fr: { id: 'fr', code: 'FR', label: 'France', domain: 'amazon.fr', assocHandle: 'frflex', authCookie: 'at-acbfr' },
};

export function isMarketplaceId(value: unknown): value is MarketplaceId {
  return MARKETPLACE_IDS.includes(value as MarketplaceId);
}

export function marketplaceForAuthCookie(cookieName: string): Marketplace | null {
  return MARKETPLACE_IDS.map((id) => MARKETPLACES[id]).find((m) => m.authCookie === cookieName) ?? null;
}

export function homeUrl(m: Marketplace): string {
  return `https://www.${m.domain}/`;
}

/**
 * Used to verify the session. It answers 200 whether or not you are signed in,
 * so the verdict comes from the navigation bar markers on the page, not the status.
 */
export function accountPageUrl(m: Marketplace): string {
  return `https://www.${m.domain}/gp/css/homepage.html`;
}

const OPENID_SELECT = encodeURIComponent('http://specs.openid.net/auth/2.0/identifier_select');
const OPENID_NS = encodeURIComponent('http://specs.openid.net/auth/2.0');

/** The account switcher / sign-in URL from the brief. Shows the active account when signed in. */
export function switcherUrl(m: Marketplace): string {
  const origin = `https://www.${m.domain}`;
  const returnTo = encodeURIComponent(`${origin}/?&ref_=nav_youraccount_switchacct`);
  return (
    `${origin}/ap/signin?openid.pape.max_auth_age=0&openid.return_to=${returnTo}` +
    `&openid.identity=${OPENID_SELECT}&openid.assoc_handle=${m.assocHandle}&openid.mode=checkid_setup` +
    `&openid.claimed_id=${OPENID_SELECT}&openid.ns=${OPENID_NS}&ignoreAuthState=1&_encoding=UTF8`
  );
}
