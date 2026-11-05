import { JSDOM } from 'jsdom';
import { describe as group, expect, it } from 'vitest';
import { classifySessionPage, isBlocked, readEmail } from '../src/classify';
import {
  CAPTCHA_PAGE,
  EMPTY_SIGN_IN_PAGE,
  SIGNED_IN_ACCOUNT_PAGE,
  SIGNED_OUT_ACCOUNT_PAGE,
  TINY_UNKNOWN_PAGE,
  WAF_CHALLENGE,
  page,
  signInPrompt,
} from './fixtures';

const parse = (html: string) => new JSDOM(html).window.document;

group('classifySessionPage', () => {
  it('recognises a signed-in account page', () => {
    expect(classifySessionPage(page(SIGNED_IN_ACCOUNT_PAGE))).toBe('signed_in');
  });

  it('recognises a signed-out account page in any language', () => {
    expect(classifySessionPage(page(SIGNED_OUT_ACCOUNT_PAGE))).toBe('signed_out');
  });

  it('treats a redirect to sign-in as signed out, even with cookies still present', () => {
    const redirected = page(EMPTY_SIGN_IN_PAGE, { finalUrl: 'https://www.amazon.de/ax/claim?arb=x' });
    expect(classifySessionPage(redirected)).toBe('signed_out');
  });

  it('never reads a 202 WAF challenge as signed out, even though response.ok is true', () => {
    const challenge = page(WAF_CHALLENGE, { status: 202, wafAction: 'challenge' });
    expect(classifySessionPage(challenge)).toBe('blocked');
  });

  it('never reads a 403 as signed out', () => {
    expect(classifySessionPage(page('<html></html>', { status: 403 }))).toBe('blocked');
  });

  it('spots a challenge page served with status 200', () => {
    expect(classifySessionPage(page(WAF_CHALLENGE))).toBe('blocked');
    expect(classifySessionPage(page(CAPTCHA_PAGE))).toBe('blocked');
  });

  it('treats a verification redirect as blocked, not signed out', () => {
    const verification = page('<html></html>', { finalUrl: 'https://www.amazon.de/ap/cvf/request?arb=x' });
    expect(classifySessionPage(verification)).toBe('blocked');
  });

  it('does not guess on a 200 page with no markers', () => {
    expect(classifySessionPage(page(TINY_UNKNOWN_PAGE))).toBe('unrecognised');
  });

  it('does not guess when the markers disagree', () => {
    const contradictory = SIGNED_IN_ACCOUNT_PAGE.replace('nav_youraccount_btn', 'nav_ya_signin');
    expect(classifySessionPage(page(contradictory))).toBe('unrecognised');
  });

  it('does not guess on other statuses', () => {
    expect(classifySessionPage(page(SIGNED_IN_ACCOUNT_PAGE, { status: 404 }))).toBe('unrecognised');
  });
});

group('isBlocked', () => {
  it('does not flag ordinary pages', () => {
    expect(isBlocked(page(SIGNED_IN_ACCOUNT_PAGE))).toBe(false);
    expect(isBlocked(page(signInPrompt('user@example.com')))).toBe(false);
  });
});

group('readEmail', () => {
  it('reads the active account from the sign-in prompt', () => {
    expect(readEmail(parse(signInPrompt('user@example.com')))).toBe('user@example.com');
  });

  it('decodes HTML entities, so plus addresses come through intact', () => {
    expect(readEmail(parse(signInPrompt('user&#43;tag@example.com')))).toBe('user+tag@example.com');
  });

  it('falls back to data-claim', () => {
    const html = '<input id="ap-credential-autofill-hint" data-claim="user@example.com">';
    expect(readEmail(parse(html))).toBe('user@example.com');
  });

  it('finds nothing on the empty sign-in form', () => {
    expect(readEmail(parse(EMPTY_SIGN_IN_PAGE))).toBeNull();
  });

  it('treats a blank value as no email', () => {
    expect(readEmail(parse('<input id="ap-claim" value="  ">'))).toBeNull();
  });
});
