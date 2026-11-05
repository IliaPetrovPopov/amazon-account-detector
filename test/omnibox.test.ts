import { describe as group, expect, it } from 'vitest';
import { MARKETPLACES, MARKETPLACE_IDS } from '../src/marketplaces';
import { escapeXml, omniboxSuggestions } from '../src/omnibox';
import { EMPTY_RECORD, type AuthRecord } from '../src/types';
import { boardRow } from '../src/view';

const NOW = new Date(2026, 10, 5, 14, 30).getTime();
const signedIn = (email: string): AuthRecord => ({
  ...EMPTY_RECORD,
  status: 'signed_in',
  email,
  confirmedAt: NOW - 60_000,
});
const signedOut: AuthRecord = { ...EMPTY_RECORD, status: 'signed_out', confirmedAt: NOW };

const records: Record<string, AuthRecord> = {
  com: signedOut,
  'co.uk': signedIn('alice@example.test'),
  de: signedIn('bob@example.test'),
  it: signedIn('alice@example.test'),
  fr: EMPTY_RECORD,
};
const rows = MARKETPLACE_IDS.map((id) => boardRow(records[id] ?? EMPTY_RECORD, MARKETPLACES[id], NOW));

group('escapeXml', () => {
  it('escapes every character the omnibox treats as markup', () => {
    expect(escapeXml(`<b>"Tom" & 'Jerry'</b>`)).toBe('&lt;b&gt;&quot;Tom&quot; &amp; &apos;Jerry&apos;&lt;/b&gt;');
  });
});

group('omniboxSuggestions', () => {
  it('lists every marketplace when nothing is typed', () => {
    const suggestions = omniboxSuggestions(rows, '');
    expect(suggestions.map((s) => s.content)).toEqual(['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.it', 'amazon.fr']);
  });

  it('describes code, domain, status, account and time', () => {
    const [uk] = omniboxSuggestions(rows, 'uk');
    expect(uk?.description).toBe('<match>UK</match>  <url>amazon.co.uk</url>  Signed in  alice@example.test  <dim>checked 14:29</dim>');
    const [us] = omniboxSuggestions(rows, 'com');
    expect(us?.description).toBe('<match>US</match>  <url>amazon.com</url>  Signed out  <dim>checked 14:30</dim>');
  });

  it('filters by code, domain, account or status, ignoring case', () => {
    expect(omniboxSuggestions(rows, 'DE').map((s) => s.content)).toEqual(['amazon.de']);
    expect(omniboxSuggestions(rows, 'alice').map((s) => s.content)).toEqual(['amazon.co.uk', 'amazon.it']);
    expect(omniboxSuggestions(rows, 'signed out').map((s) => s.content)).toEqual(['amazon.com']);
    expect(omniboxSuggestions(rows, 'not checked').map((s) => s.content)).toEqual(['amazon.fr']);
  });

  it('needs every typed word to match', () => {
    expect(omniboxSuggestions(rows, 'alice it').map((s) => s.content)).toEqual(['amazon.it']);
    expect(omniboxSuggestions(rows, 'alice fr')).toEqual([]);
  });

  it('shows a nickname with the email dimmed after it, and finds accounts by nickname', () => {
    const names = { 'alice@example.test': 'Main <buyer>' };
    const named = MARKETPLACE_IDS.map((id) => boardRow(records[id] ?? EMPTY_RECORD, MARKETPLACES[id], NOW, null, names));
    const [uk] = omniboxSuggestions(named, 'uk');
    expect(uk?.description).toBe(
      '<match>UK</match>  <url>amazon.co.uk</url>  Signed in  Main &lt;buyer&gt; <dim>alice@example.test</dim>  <dim>checked 14:29</dim>',
    );
    expect(omniboxSuggestions(named, 'main').map((s) => s.content)).toEqual(['amazon.co.uk', 'amazon.it']);
  });

  it('cannot be broken by markup in an account name', () => {
    const tricky = boardRow(signedIn('a<b>&c@example.test'), MARKETPLACES.de, NOW);
    expect(omniboxSuggestions([tricky], '')[0]?.description).toContain('a&lt;b&gt;&amp;c@example.test');
  });
});
