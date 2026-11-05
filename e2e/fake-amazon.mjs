// A local stand-in for the five Amazon sites. Chrome reaches it through --host-resolver-rules,
// so the extension uses its real URLs and cookies while nothing leaves this machine.
// Pages carry only the markers the extension reads, as seen on real Amazon pages.
import { createServer } from 'node:https';

export const AUTH_COOKIES = {
  'www.amazon.com': 'at-main',
  'www.amazon.co.uk': 'at-acbuk',
  'www.amazon.de': 'at-acbde',
  'www.amazon.it': 'at-acbit',
  'www.amazon.fr': 'at-acbfr',
};

const page = (head, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

const ACCOUNT_PAGE_SIGNED_IN = page(
  `<title>Your Account</title><script>$Nav.declare('config.customerName', 'Test');</script>`,
  '<div id="nav-link-accountList"><a data-nav-ref="nav_youraccount_btn" href="/gp/css/homepage.html">Hello, Test</a></div>',
);

const ACCOUNT_PAGE_SIGNED_OUT = page(
  `<title>Your Account</title><script>$Nav.declare('config.customerName', false);</script>`,
  '<div id="nav-link-accountList"><a data-nav-ref="nav_ya_signin" href="/ap/signin">Hello, sign in</a></div>',
);

const signInPrompt = (email) =>
  page(
    '<title>Sign in</title>',
    `<a id="ap_switch_account_link" href="/ap/signin?switch_account=">Switch accounts</a>
     <div class="auth-text-truncate">${email}</div>
     <input id="ap-claim" type="hidden" name="email" value="${email}">
     <form name="signIn" method="post" action="/ap/signin"><input id="ap_password" type="password" name="password"></form>`,
  );

const SIGN_IN_FORM_EMPTY = page(
  '<title>Sign in</title>',
  '<form id="ap_login_form" method="post" action="/ax/claim"><input id="ap_email_login" name="email"></form>',
);

const WAF_CHALLENGE = page(
  '<script>window.gokuProps = {};</script><script src="https://example.token.awswaf.com/x/challenge.js"></script>',
  '<noscript>Enable JavaScript</noscript>',
);

const STOREFRONT = page('<title>Amazon</title>', '<input id="twotabsearchtextbox" name="field-keywords">');

function cookieValue(header, name) {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export async function startFakeAmazon({ key, cert }) {
  const state = {
    /** 'normal', 'offline' (connection dropped) or 'challenge' (AWS WAF 202) */
    mode: 'normal',
    delayMs: 0,
    /** Auth cookie value to account email. */
    accounts: new Map(),
    /** Auth cookie values Amazon no longer accepts, as after a password change on another device. */
    expired: new Set(),
    /** Hosts that answer with a challenge whatever the mode. */
    challengeHosts: new Set(),
    requests: [],
  };

  const server = createServer({ key, cert }, (request, response) => {
    const host = (request.headers.host ?? '').split(':')[0];
    const path = new URL(request.url ?? '/', `https://${host}`).pathname;
    state.requests.push({ host, path, at: Date.now() });

    if (state.mode === 'offline') {
      request.socket.destroy();
      return;
    }

    const send = (status, body, headers = {}) => {
      response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
      response.end(body);
    };

    const reply = () => {
      if (state.mode === 'challenge' || state.challengeHosts.has(host)) {
        return send(202, WAF_CHALLENGE, { 'x-amzn-waf-action': 'challenge' });
      }
      const token = cookieValue(request.headers.cookie, AUTH_COOKIES[host]);
      const email = token && !state.expired.has(token) ? (state.accounts.get(token) ?? null) : null;
      if (path === '/gp/css/homepage.html') return send(200, email ? ACCOUNT_PAGE_SIGNED_IN : ACCOUNT_PAGE_SIGNED_OUT);
      if (path === '/ap/signin') return send(200, email ? signInPrompt(email) : SIGN_IN_FORM_EMPTY);
      if (path === '/') return send(200, STOREFRONT);
      return send(404, page('', 'Not found'));
    };

    if (state.delayMs > 0) setTimeout(reply, state.delayMs);
    else reply();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    state,
    port: server.address().port,
    requestsSince: (at) => state.requests.filter((r) => r.at >= at),
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
