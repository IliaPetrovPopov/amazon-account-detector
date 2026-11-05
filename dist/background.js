"use strict";
(() => {
  // src/history.ts
  var HOUR = 36e5;
  var HISTORY_RETENTION_MS = 30 * 24 * HOUR;
  var HISTORY_MAX_EVENTS = 1e3;
  var TIMELINE_WINDOW_MS = 24 * HOUR;
  function identityOf(record) {
    if (record.problem !== null && record.problem !== "email_unavailable") return void 0;
    if (record.status === "signed_out") return { email: null };
    if (record.status === "signed_in" && record.email) return { email: record.email };
    return void 0;
  }
  function appendHistory(events, record, now) {
    const identity = identityOf(record);
    const kept = events.filter((event) => now - event.at <= HISTORY_RETENTION_MS);
    if (!identity) return kept;
    const last = kept.at(-1);
    if (last && sameAccount(last.email, identity.email)) return kept;
    return [...kept, { at: now, email: identity.email }].slice(-HISTORY_MAX_EVENTS);
  }
  function sameAccount(a, b) {
    if (a === null || b === null) return a === b;
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  // src/identity.ts
  var ACCOUNT_COLORS = ["#853FD8", "#0E7A9B", "#D5217E", "#006CB4", "#A85334"];
  var accountKey = (email) => email.trim().toLowerCase();
  function hashSlot(key) {
    let hash2 = 0;
    for (const char of key) hash2 = hash2 * 31 + char.charCodeAt(0) >>> 0;
    return hash2 % ACCOUNT_COLORS.length;
  }
  function assignColors(slots, known) {
    const keys = [...new Set(known.map(accountKey).filter(Boolean))];
    const next = {};
    for (const key of keys) {
      const slot = slots[key];
      if (slot !== void 0 && slot >= 0 && slot < ACCOUNT_COLORS.length) next[key] = slot;
    }
    for (const key of keys) {
      if (next[key] !== void 0) continue;
      const used = new Set(Object.values(next));
      const free = ACCOUNT_COLORS.findIndex((_, index) => !used.has(index));
      next[key] = free === -1 ? hashSlot(key) : free;
    }
    return next;
  }
  function sameColors(a, b) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
  }
  function accountsInOrder(history, current) {
    const events = [...history].sort((a, b) => a.at - b.at);
    return [...events.map((event) => event.email), ...current].filter((email) => Boolean(email));
  }
  var NAME_MAX_LENGTH = 40;
  var UNSAFE_CHARACTERS = /[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
  function cleanName(raw) {
    const text = raw.replace(/\s+/g, " ").replace(UNSAFE_CHARACTERS, "").replace(/ {2,}/g, " ").trim();
    const characters = [...new Intl.Segmenter(void 0, { granularity: "grapheme" }).segment(text)].map((part) => part.segment);
    return characters.slice(0, NAME_MAX_LENGTH).join("").trim();
  }
  function nameFor(names, email) {
    if (!email) return null;
    return names[accountKey(email)] || null;
  }
  function accountLabel(names, email) {
    const name = nameFor(names, email);
    return name ? `${name} (${email})` : email;
  }
  function withName(names, email, raw) {
    const key = accountKey(email);
    const name = cleanName(raw);
    const next = { ...names };
    delete next[key];
    if (name) next[key] = name;
    return next;
  }
  function pinState(pin, signedInEmail) {
    if (!pin) return "none";
    if (!signedInEmail) return "none";
    return sameAccount(pin, signedInEmail) ? "match" : "mismatch";
  }

  // src/marketplaces.ts
  var MARKETPLACE_IDS = ["com", "co.uk", "de", "it", "fr"];
  var MARKETPLACES = {
    com: { id: "com", code: "US", label: "United States", domain: "amazon.com", assocHandle: "usflex", authCookie: "at-main" },
    "co.uk": { id: "co.uk", code: "UK", label: "United Kingdom", domain: "amazon.co.uk", assocHandle: "gbflex", authCookie: "at-acbuk" },
    de: { id: "de", code: "DE", label: "Germany", domain: "amazon.de", assocHandle: "deflex", authCookie: "at-acbde" },
    it: { id: "it", code: "IT", label: "Italy", domain: "amazon.it", assocHandle: "itflex", authCookie: "at-acbit" },
    fr: { id: "fr", code: "FR", label: "France", domain: "amazon.fr", assocHandle: "frflex", authCookie: "at-acbfr" }
  };
  function isMarketplaceId(value) {
    return MARKETPLACE_IDS.includes(value);
  }
  function marketplaceForAuthCookie(cookieName) {
    return MARKETPLACE_IDS.map((id) => MARKETPLACES[id]).find((m) => m.authCookie === cookieName) ?? null;
  }
  function homeUrl(m) {
    return `https://www.${m.domain}/`;
  }
  function accountPageUrl(m) {
    return `https://www.${m.domain}/gp/css/homepage.html`;
  }
  var OPENID_SELECT = encodeURIComponent("http://specs.openid.net/auth/2.0/identifier_select");
  var OPENID_NS = encodeURIComponent("http://specs.openid.net/auth/2.0");
  function switcherUrl(m) {
    const origin = `https://www.${m.domain}`;
    const returnTo = encodeURIComponent(`${origin}/?&ref_=nav_youraccount_switchacct`);
    return `${origin}/ap/signin?openid.pape.max_auth_age=0&openid.return_to=${returnTo}&openid.identity=${OPENID_SELECT}&openid.assoc_handle=${m.assocHandle}&openid.mode=checkid_setup&openid.claimed_id=${OPENID_SELECT}&openid.ns=${OPENID_NS}&ignoreAuthState=1&_encoding=UTF8`;
  }

  // src/alerts.ts
  var alertId = (m) => `alert:${m.id}`;
  function marketplaceOfAlert(notificationId) {
    const id = notificationId.startsWith("alert:") ? notificationId.slice("alert:".length) : null;
    return isMarketplaceId(id) ? id : null;
  }
  function alertFor(m, previous, next, pin, names) {
    if (next.problem !== null && next.problem !== "email_unavailable") return null;
    if (previous.status === "signed_in" && next.status === "signed_out") {
      const who = previous.email ? accountLabel(names, previous.email) : "The account";
      return { title: `Signed out on ${m.domain}`, message: `${who} is no longer signed in. Click to sign in again.` };
    }
    if (next.status === "signed_in" && next.email && pin && pinState(pin, next.email) === "mismatch") {
      const sameAsBefore = previous.status === "signed_in" && sameAccount(previous.email, next.email);
      if (sameAsBefore) return null;
      return {
        title: `Wrong account on ${m.domain}`,
        message: `${accountLabel(names, next.email)} is signed in, not ${accountLabel(names, pin)}. Click to switch accounts.`
      };
    }
    return null;
  }

  // src/types.ts
  var EMPTY_RECORD = {
    status: "unknown",
    email: null,
    confirmedAt: null,
    attemptedAt: null,
    problem: null,
    sessionKey: null,
    emailCheckedAt: null
  };

  // src/store.ts
  var SELECTED_KEY = "selectedMarketplace";
  var COLORS_KEY = "accountColors";
  var NAMES_KEY = "accountNames";
  var ALERTS_KEY = "alertsEnabled";
  var authKey = (id) => `auth:${id}`;
  var pinKey = (id) => `pin:${id}`;
  var historyKey = (id) => `history:${id}`;
  async function readAll(keyOf, fallback) {
    const found = await chrome.storage.local.get(MARKETPLACE_IDS.map(keyOf));
    return Object.fromEntries(
      MARKETPLACE_IDS.map((id) => [id, found[keyOf(id)] ?? fallback])
    );
  }
  var authStore = {
    async get(id) {
      const key = authKey(id);
      const found = await chrome.storage.local.get(key);
      return found[key] ?? EMPTY_RECORD;
    },
    getAll: () => readAll(authKey, EMPTY_RECORD),
    async set(id, record) {
      await chrome.storage.local.set({ [authKey(id)]: record });
    }
  };
  var pinStore = {
    async get(id) {
      const key = pinKey(id);
      const found = await chrome.storage.local.get(key);
      return found[key] ?? null;
    },
    getAll: () => readAll(pinKey, null),
    async set(id, email) {
      if (email) await chrome.storage.local.set({ [pinKey(id)]: email });
      else await chrome.storage.local.remove(pinKey(id));
    }
  };
  var historyStore = {
    getAll: () => readAll(historyKey, []),
    async record(id, record, now) {
      const key = historyKey(id);
      const found = await chrome.storage.local.get(key);
      const events = found[key] ?? [];
      const next = appendHistory(events, record, now);
      if (next.length !== events.length || next.at(-1) !== events.at(-1)) {
        await chrome.storage.local.set({ [key]: next });
      }
    }
  };
  var colorStore = {
    async get() {
      const found = await chrome.storage.local.get(COLORS_KEY);
      return found[COLORS_KEY] ?? {};
    },
    async set(slots) {
      await chrome.storage.local.set({ [COLORS_KEY]: slots });
    }
  };
  var nameStore = {
    async get() {
      const found = await chrome.storage.local.get(NAMES_KEY);
      return found[NAMES_KEY] ?? {};
    },
    /** Saves a cleaned nickname, or removes it when nothing is left after cleaning. Returns what was stored. */
    async set(email, raw) {
      const next = withName(await nameStore.get(), email, raw);
      await chrome.storage.local.set({ [NAMES_KEY]: next });
      return next;
    }
  };
  var alertStore = {
    async enabled() {
      const found = await chrome.storage.local.get(ALERTS_KEY);
      return found[ALERTS_KEY] === true;
    },
    async set(on) {
      if (on) await chrome.storage.local.set({ [ALERTS_KEY]: true });
      else await chrome.storage.local.remove(ALERTS_KEY);
    }
  };
  async function loadSelectedMarketplace() {
    const found = await chrome.storage.local.get(SELECTED_KEY);
    const value = found[SELECTED_KEY];
    return isMarketplaceId(value) ? value : "com";
  }
  function touchesAuthState(changedKeys) {
    return changedKeys.some(
      (key) => key === SELECTED_KEY || key === COLORS_KEY || key === NAMES_KEY || key.startsWith("auth:") || key.startsWith("pin:") || key.startsWith("history:")
    );
  }
  function touchesAccounts(changedKeys) {
    return changedKeys.some((key) => key.startsWith("pin:"));
  }

  // src/view.ts
  var MINUTE = 6e4;
  var HOUR2 = 60 * MINUTE;
  var DAY = 24 * HOUR2;
  var STALE_AFTER_MS = 90 * MINUTE;
  function formatAge(ms) {
    if (ms < MINUTE) return "just now";
    if (ms < HOUR2) return `${Math.floor(ms / MINUTE)} min ago`;
    if (ms < DAY) {
      const hours = Math.floor(ms / HOUR2);
      return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    }
    const days = Math.floor(ms / DAY);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  function clockTime(ms) {
    const date = new Date(ms);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  function noticeFor(problem, m) {
    switch (problem) {
      case "network":
        return "Could not reach Amazon. Check your connection and try again.";
      case "challenge":
        return `Amazon asked for a browser check. Open ${m.domain} once, then check again.`;
      case "unrecognised":
        return "Amazon returned a page this extension does not recognise.";
      case "email_unavailable":
        return "Amazon did not show the email on this check.";
      default:
        return null;
    }
  }
  function isLastKnown(record, now) {
    const age = record.confirmedAt === null ? null : now - record.confirmedAt;
    const failed = record.problem !== null && record.problem !== "email_unavailable";
    return age !== null && age > STALE_AFTER_MS || failed;
  }
  function describe(record, m, now, checking, pin = null) {
    const age = record.confirmedAt === null ? null : now - record.confirmedAt;
    const lastKnown = isLastKnown(record, now);
    const signedInEmail = record.status === "signed_in" ? record.email : null;
    const pinned = pinState(pin, signedInEmail);
    let tone = "off";
    let status;
    let headline;
    let account = null;
    let action = null;
    switch (record.status) {
      case "signed_in":
        if (pinned === "mismatch") {
          tone = "alert";
          status = "Wrong account";
          headline = lastKnown ? "Last known: wrong account" : "Wrong account";
          action = { label: "Switch account", url: switcherUrl(m), primary: true };
        } else {
          tone = lastKnown ? "warn" : "ok";
          status = lastKnown ? "Last known" : "Signed in";
          headline = lastKnown ? "Last known: signed in" : "Signed in";
        }
        account = record.email ?? "Email not available";
        break;
      case "signed_out":
        tone = lastKnown ? "warn" : "off";
        status = lastKnown ? "Last known" : "Signed out";
        headline = lastKnown ? "Last known: not signed in" : "Not signed in";
        action = { label: `Sign in on ${m.domain}`, url: switcherUrl(m), primary: true };
        break;
      default:
        tone = record.problem ? "warn" : "off";
        status = record.problem ? "No answer" : "Not checked";
        headline = record.problem ? "Could not check" : "Not checked yet";
    }
    if (record.problem === "challenge") action = { label: `Open ${m.domain}`, url: homeUrl(m), primary: false };
    let freshness = "";
    if (checking) freshness = "Checking\u2026";
    else if (age !== null) freshness = `${lastKnown ? "Last confirmed" : "Checked"} ${formatAge(age)}`;
    return {
      tone,
      status,
      headline,
      account,
      accountMuted: lastKnown || record.email === null,
      notice: noticeFor(record.problem, m),
      freshness,
      time: record.confirmedAt === null ? null : clockTime(record.confirmedAt),
      action,
      pin: { state: pinned, email: pin }
    };
  }
  function boardRow(record, m, now, pin = null, names = {}) {
    const view = describe(record, m, now, false, pin);
    const email = record.status === "signed_in" ? record.email : null;
    const pinNote = view.pin.state === "mismatch" && pin ? `pinned account is ${accountLabel(names, pin)}` : null;
    return {
      id: m.id,
      code: m.code,
      country: m.label,
      domain: m.domain,
      tone: view.tone,
      account: email ?? "",
      name: nameFor(names, email),
      status: view.status,
      dim: isLastKnown(record, now),
      freshness: view.freshness,
      time: view.time,
      pin,
      pinState: view.pin.state,
      label: [m.domain, view.headline, email && accountLabel(names, email), pinNote, view.freshness].filter(Boolean).join(", ")
    };
  }
  var BADGE_COLORS = {
    ok: { color: "#16A34A", textColor: "#FFFFFF" },
    off: { color: "#5B6B86", textColor: "#FFFFFF" },
    warn: { color: "#F5C24B", textColor: "#16203B" },
    alert: { color: "#DC2626", textColor: "#FFFFFF" }
  };
  function badgeView(record, m, now, pin = null, names = {}) {
    const view = describe(record, m, now, false, pin);
    const who = record.status === "signed_in" && record.email ? ` as ${accountLabel(names, record.email)}` : "";
    const pinNote = view.pin.state === "mismatch" && pin ? `
Pinned account: ${accountLabel(names, pin)}` : "";
    return {
      text: m.code,
      ...BADGE_COLORS[view.tone],
      title: `Amazon Account Detector
${m.domain}: ${view.headline}${who}${pinNote}`
    };
  }

  // src/badge.ts
  async function refreshBadge() {
    const id = await loadSelectedMarketplace();
    const [record, pin, names] = await Promise.all([authStore.get(id), pinStore.get(id), nameStore.get()]);
    const view = badgeView(record, MARKETPLACES[id], Date.now(), pin, names);
    await Promise.all([
      chrome.action.setBadgeText({ text: view.text }),
      chrome.action.setBadgeBackgroundColor({ color: view.color }),
      chrome.action.setBadgeTextColor({ color: view.textColor }),
      chrome.action.setTitle({ title: view.title })
    ]);
  }

  // src/classify.ts
  var BLOCKING_STATUSES = /* @__PURE__ */ new Set([202, 403, 429, 503]);
  var CHALLENGE_MARKERS = /gokuProps|AwsWafIntegration|validateCaptcha|opfcaptcha|captchacharacters/i;
  var CHALLENGE_PATHS = /^\/(?:(?:ap|ax)\/cvf|errors\/validateCaptcha)/;
  var SIGN_IN_PATHS = /^\/(?:ap\/signin|ax\/claim)/;
  var CUSTOMER_NAME = /config\.customerName['"]?\s*,\s*(false|null|["'])/;
  var SIGNED_IN_NAV_REF = "nav_youraccount_btn";
  var SIGNED_OUT_NAV_REF = "nav_ya_signin";
  function pathOf(url) {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  }
  function isBlocked(page) {
    return page.wafAction !== null || BLOCKING_STATUSES.has(page.status) || CHALLENGE_PATHS.test(pathOf(page.finalUrl)) || CHALLENGE_MARKERS.test(page.html);
  }
  function classifySessionPage(page) {
    if (isBlocked(page)) return "blocked";
    if (page.status !== 200) return "unrecognised";
    if (SIGN_IN_PATHS.test(pathOf(page.finalUrl))) return "signed_out";
    const customerName = page.html.match(CUSTOMER_NAME)?.[1];
    const hasSignedInRef = page.html.includes(SIGNED_IN_NAV_REF);
    const hasSignedOutRef = page.html.includes(SIGNED_OUT_NAV_REF);
    const nameIsEmpty = customerName === "false" || customerName === "null";
    if (customerName && !nameIsEmpty && hasSignedInRef && !hasSignedOutRef) return "signed_in";
    if (nameIsEmpty && hasSignedOutRef && !hasSignedInRef) return "signed_out";
    return "unrecognised";
  }

  // src/check.ts
  var MINUTE2 = 6e4;
  var HOUR3 = 60 * MINUTE2;
  var FRESH_FOR_MS = 5 * MINUTE2;
  var EMAIL_REUSE_FOR_MS = 24 * HOUR3;
  var CHALLENGE_BACKOFF_MS = 6 * HOUR3;
  async function checkMarketplace(m, previous, options, deps) {
    const now = deps.now();
    const cookie = await deps.readAuthCookie(m);
    if (!cookie) return signedOut(now);
    const sessionKey = await deps.hash(cookie);
    const sameSession = previous.sessionKey === sessionKey;
    if (!options.force && sameSession) {
      const conclusive = previous.confirmedAt !== null && previous.problem === null;
      if (conclusive && now - previous.confirmedAt < FRESH_FOR_MS) return previous;
      const backingOff = previous.problem === "challenge" && previous.attemptedAt !== null && now - previous.attemptedAt < CHALLENGE_BACKOFF_MS;
      if (backingOff) return previous;
    }
    const inconclusive = (problem) => sameSession ? { ...previous, attemptedAt: now, problem } : { ...EMPTY_RECORD, attemptedAt: now, problem, sessionKey };
    let sessionPage;
    try {
      sessionPage = await deps.fetchPage(accountPageUrl(m));
    } catch {
      return inconclusive("network");
    }
    switch (classifySessionPage(sessionPage)) {
      case "signed_out":
        return signedOut(now, sessionKey);
      case "blocked":
        return inconclusive("challenge");
      case "unrecognised":
        return inconclusive("unrecognised");
      case "signed_in":
        break;
    }
    const emailStillValid = sameSession && previous.email !== null && previous.emailCheckedAt !== null && now - previous.emailCheckedAt < EMAIL_REUSE_FOR_MS;
    const signedIn = (email2, emailCheckedAt, problem) => ({
      status: "signed_in",
      email: email2,
      confirmedAt: now,
      attemptedAt: now,
      problem,
      sessionKey,
      emailCheckedAt
    });
    if (emailStillValid) return signedIn(previous.email, previous.emailCheckedAt, null);
    const withoutNewEmail = (problem) => sameSession ? signedIn(previous.email, previous.emailCheckedAt, problem) : signedIn(null, null, problem);
    let signInPage;
    try {
      signInPage = await deps.fetchPage(switcherUrl(m));
    } catch {
      return withoutNewEmail("network");
    }
    if (isBlocked(signInPage)) return withoutNewEmail("challenge");
    if (signInPage.status !== 200) return withoutNewEmail("unrecognised");
    let email;
    try {
      email = await deps.extractEmail(signInPage.html);
    } catch {
      return withoutNewEmail("email_unavailable");
    }
    return email ? signedIn(email, now, null) : withoutNewEmail("email_unavailable");
  }
  function signedOut(now, sessionKey = null) {
    return { ...EMPTY_RECORD, status: "signed_out", confirmedAt: now, attemptedAt: now, sessionKey };
  }

  // src/offscreen-client.ts
  var OFFSCREEN_URL = "offscreen.html";
  var queue = Promise.resolve();
  async function ensureDocument() {
    const existing = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
    });
    if (existing.length > 0) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: "Read the account email from Amazon sign-in HTML. Service workers have no DOMParser."
    });
  }
  function extractEmailOffscreen(html) {
    const run = queue.then(async () => {
      await ensureDocument();
      try {
        const request = { target: "offscreen", html };
        const email = await chrome.runtime.sendMessage(request);
        return email;
      } finally {
        await chrome.offscreen.closeDocument();
      }
    });
    queue = run.catch(() => void 0);
    return run;
  }

  // src/omnibox.ts
  function escapeXml(text) {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
  }
  function matches(row, query) {
    if (!query) return true;
    const haystack = [row.code, row.domain, row.account, row.name ?? "", row.status].join(" ").toLowerCase();
    return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
  }
  function omniboxSuggestions(rows, query) {
    return rows.filter((row) => matches(row, query.trim())).map((row) => {
      const account = row.name ? `${escapeXml(row.name)} <dim>${escapeXml(row.account)}</dim>` : escapeXml(row.account);
      const who = row.account ? `  ${account}` : "";
      const when = row.time ? `  <dim>checked ${row.time}</dim>` : "";
      return {
        content: row.domain,
        description: `<match>${row.code}</match>  <url>${row.domain}</url>  ${escapeXml(row.status)}${who}${when}`
      };
    });
  }

  // src/service.ts
  function createAuthService({ store, check, onStored, settleMs = 1500 }) {
    const inFlight = /* @__PURE__ */ new Map();
    const generations = /* @__PURE__ */ new Map();
    const pendingRechecks = /* @__PURE__ */ new Map();
    const generationOf = (id) => generations.get(id) ?? 0;
    async function perform(id, options) {
      const startedIn = generationOf(id);
      const previous = await store.get(id);
      const next = await check(MARKETPLACES[id], previous, options);
      if (generationOf(id) !== startedIn) return previous;
      if (next !== previous) {
        await store.set(id, next);
        await onStored?.(id, next, previous).catch((error) => console.warn("After-store step failed", id, error));
      }
      return next;
    }
    function request(id, options = {}) {
      const running = inFlight.get(id);
      if (running) return running;
      const run = perform(id, options).finally(() => inFlight.delete(id));
      inFlight.set(id, run);
      return run;
    }
    function onSessionSignal(id) {
      generations.set(id, generationOf(id) + 1);
      const pending = pendingRechecks.get(id);
      if (pending) clearTimeout(pending);
      pendingRechecks.set(
        id,
        setTimeout(async () => {
          pendingRechecks.delete(id);
          await inFlight.get(id)?.catch(() => void 0);
          await request(id, { force: true }).catch((error) => console.warn("Recheck failed", id, error));
        }, settleMs)
      );
    }
    return { request, onSessionSignal };
  }

  // src/session-signal.ts
  function sessionSignal(change) {
    const marketplace = marketplaceForAuthCookie(change.cookie.name);
    if (!marketplace) return null;
    if (change.removed && change.cause === "overwrite") return null;
    return marketplace.id;
  }

  // src/background.ts
  var REFRESH_ALARM = "refresh-auth";
  var REFRESH_EVERY_MINUTES = 60;
  async function fetchPage(url) {
    const response = await fetch(url, {
      // Amazon is cross-origin from the extension, so the default would send no cookies.
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(2e4)
    });
    return {
      status: response.status,
      finalUrl: response.url,
      wafAction: response.headers.get("x-amzn-waf-action"),
      html: await response.text()
    };
  }
  async function readAuthCookie(m) {
    const cookie = await chrome.cookies.get({ url: `https://www.${m.domain}/`, name: m.authCookie });
    return cookie?.value || null;
  }
  async function hash(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  var checkDeps = {
    readAuthCookie,
    fetchPage,
    extractEmail: extractEmailOffscreen,
    hash,
    now: () => Date.now()
  };
  var colorsDone = Promise.resolve();
  function syncColors() {
    colorsDone = colorsDone.then(async () => {
      const [records, pins, history, slots] = await Promise.all([
        authStore.getAll(),
        pinStore.getAll(),
        historyStore.getAll(),
        colorStore.get()
      ]);
      const current = MARKETPLACE_IDS.flatMap((id) => [
        records[id].status === "signed_in" ? records[id].email : null,
        pins[id]
      ]);
      const next = assignColors(slots, accountsInOrder(MARKETPLACE_IDS.flatMap((id) => history[id]), current));
      if (!sameColors(slots, next)) await colorStore.set(next);
    }).catch((error) => console.warn("Colour update failed", error));
    return colorsDone;
  }
  async function alertIfNeeded(id, previous, record) {
    if (!await alertStore.enabled()) return;
    const [pin, names] = await Promise.all([pinStore.get(id), nameStore.get()]);
    const alert = alertFor(MARKETPLACES[id], previous, record, pin, names);
    if (!alert) return;
    await chrome.notifications.create(alertId(MARKETPLACES[id]), {
      type: "basic",
      iconUrl: "icons/icon-128.png",
      title: alert.title,
      message: alert.message,
      priority: 1
    });
  }
  var service = createAuthService({
    store: authStore,
    check: (m, previous, options) => checkMarketplace(m, previous, options, checkDeps),
    onStored: async (id, record, previous) => {
      await historyStore.record(id, record, Date.now());
      await syncColors();
      await alertIfNeeded(id, previous, record).catch((error) => console.warn("Alert failed", id, error));
    }
  });
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function refreshAll() {
    for (const id of MARKETPLACE_IDS) {
      await service.request(id).catch((error) => console.warn("Refresh failed", id, error));
      await sleep(500 + Math.random() * 1500);
    }
  }
  var updateBadge = () => refreshBadge().catch((error) => console.warn("Badge update failed", error));
  async function startup() {
    const existing = await chrome.alarms.get(REFRESH_ALARM);
    if (!existing) await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_EVERY_MINUTES });
    await updateBadge();
    await syncColors();
    await refreshAll();
  }
  chrome.runtime.onInstalled.addListener(() => void startup());
  chrome.runtime.onStartup.addListener(() => void startup());
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== REFRESH_ALARM) return;
    void refreshAll().then(updateBadge);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const keys = Object.keys(changes);
    if (touchesAuthState(keys)) void updateBadge();
    if (touchesAccounts(keys)) void syncColors();
  });
  chrome.omnibox.setDefaultSuggestion({ description: "Show which Amazon account is signed in on each marketplace" });
  chrome.omnibox.onInputChanged.addListener((text, suggest) => {
    void Promise.all([authStore.getAll(), pinStore.getAll(), nameStore.get()]).then(([records, pins, names]) => {
      const now = Date.now();
      const rows = MARKETPLACE_IDS.map((id) => boardRow(records[id], MARKETPLACES[id], now, pins[id], names));
      suggest(omniboxSuggestions(rows, text));
    });
  });
  chrome.omnibox.onInputEntered.addListener((text, disposition) => {
    const marketplace = MARKETPLACE_IDS.map((id) => MARKETPLACES[id]).find((m) => m.domain === text.trim());
    const url = marketplace ? homeUrl(marketplace) : chrome.runtime.getURL("board.html");
    if (disposition === "currentTab") void chrome.tabs.update({ url });
    else void chrome.tabs.create({ url, active: disposition === "newForegroundTab" });
  });
  chrome.notifications.onClicked.addListener((notificationId) => {
    void chrome.notifications.clear(notificationId);
    const id = marketplaceOfAlert(notificationId);
    if (id) void chrome.tabs.create({ url: switcherUrl(MARKETPLACES[id]) });
  });
  chrome.cookies.onChanged.addListener((change) => {
    const id = sessionSignal(change);
    if (id) service.onSessionSignal(id);
  });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "check" || !isMarketplaceId(message.marketplace)) return false;
    service.request(message.marketplace, { force: message.force }).then(sendResponse).catch((error) => {
      console.warn("Check failed", message.marketplace, error);
      sendResponse(null);
    });
    return true;
  });
})();
