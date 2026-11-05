import type { PageResponse } from '../src/types';

// Hand-reduced from the structure of real Amazon pages. No captured markup or personal data.

export const page = (html: string, overrides: Partial<PageResponse> = {}): PageResponse => ({
  status: 200,
  finalUrl: 'https://www.amazon.de/gp/css/homepage.html',
  wafAction: null,
  html,
  ...overrides,
});

export const SIGNED_IN_ACCOUNT_PAGE = `<!doctype html><html lang="en-gb"><head><title>Your Account</title>
<script>$Nav.declare('config.customerName', 'Test');</script></head>
<body><div id="nav-link-accountList"><a data-nav-ref="nav_youraccount_btn" href="/gp/css/homepage.html">
<span id="nav-link-accountList-nav-line-1">Hello, Test</span></a></div></body></html>`;

export const SIGNED_OUT_ACCOUNT_PAGE = `<!doctype html><html lang="de-de"><head><title>Mein Konto</title>
<script>$Nav.declare('config.customerName', false);</script></head>
<body><div id="nav-link-accountList"><a data-nav-ref="nav_ya_signin" href="/ap/signin">
<span id="nav-link-accountList-nav-line-1">Hallo, anmelden</span></a></div></body></html>`;

export const WAF_CHALLENGE = `<!doctype html><html lang="en"><head>
<script>window.gokuProps = {"key":"k"};</script>
<script src="https://example.token.awswaf.com/x/y/z/challenge.js"></script></head>
<body><script>AwsWafIntegration.getToken();</script><noscript>Enable JavaScript</noscript></body></html>`;

export const CAPTCHA_PAGE = `<!doctype html><html><body><form action="/errors/validateCaptcha">
<input id="captchacharacters" name="field-keywords"></form></body></html>`;

/** A small 200 page with no recognisable markers, as seen from amazon.co.uk with no cookies. */
export const TINY_UNKNOWN_PAGE = '<!doctype html><html><body><script>var x = 1;</script></body></html>';

export const signInPrompt = (email: string) => `<!doctype html><html lang="en-GB"><body><div id="a-page">
<a id="ap_switch_account_link" href="/ap/signin?switch_account=">Switch accounts</a>
<div class="auth-prompt-section">
  <div class="auth-prompt-profile-details"><div class="auth-text-truncate">${email}</div></div>
  <input id="ap-claim" type="hidden" name="email" value="${email}">
  <input id="ap-credential-autofill-hint" class="hide" type="text" name="claim-autofill-hint" value="${email}" data-claim="${email}">
</div>
<form name="signIn" method="post" action="/ap/signin">
  <input id="ap-claim" type="hidden" name="email" value="${email}">
  <input id="ap_password" type="password" name="password">
</form></div></body></html>`;

export const EMPTY_SIGN_IN_PAGE = `<!doctype html><html lang="en-us"><body>
<form id="ap_login_form" name="signIn" method="post" action="/ax/claim">
  <input id="ap_email_login" type="text" name="email" aria-label="Enter mobile number or email">
  <input type="password" name="password">
</form></body></html>`;
