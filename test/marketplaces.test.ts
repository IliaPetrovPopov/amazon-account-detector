import { describe as group, expect, it } from 'vitest';
import { MARKETPLACES, MARKETPLACE_IDS, marketplaceForAuthCookie, switcherUrl } from '../src/marketplaces';

const BRIEF_URL_FOR_COM =
  'https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.com%2F%3F%26ref_%3Dnav_youraccount_switchacct&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0&ignoreAuthState=1&_encoding=UTF8';

group('switcherUrl', () => {
  it('matches the URL in the brief exactly', () => {
    expect(switcherUrl(MARKETPLACES.com)).toBe(BRIEF_URL_FOR_COM);
  });

  it.each([
    ['co.uk', 'www.amazon.co.uk', 'gbflex'],
    ['de', 'www.amazon.de', 'deflex'],
    ['it', 'www.amazon.it', 'itflex'],
    ['fr', 'www.amazon.fr', 'frflex'],
  ] as const)('uses the host and handle of %s', (id, host, handle) => {
    const expected = BRIEF_URL_FOR_COM.replaceAll('www.amazon.com', host).replace('usflex', handle);
    expect(switcherUrl(MARKETPLACES[id])).toBe(expected);
  });
});

group('marketplaceForAuthCookie', () => {
  it('finds every marketplace by its auth cookie', () => {
    for (const id of MARKETPLACE_IDS) {
      expect(marketplaceForAuthCookie(MARKETPLACES[id].authCookie)?.id).toBe(id);
    }
  });

  it('ignores cookies that exist without a login', () => {
    for (const name of ['sst-main', 'ubid-acbde', 'session-id', 'session-token', 'x-main']) {
      expect(marketplaceForAuthCookie(name)).toBeNull();
    }
  });
});
