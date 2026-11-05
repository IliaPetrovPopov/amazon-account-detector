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
  function timelineSegments(events, now, windowMs = TIMELINE_WINDOW_MS) {
    const windowStart = now - windowMs;
    const segments = [];
    const ordered = [...events].sort((a, b) => a.at - b.at);
    ordered.forEach((event, index) => {
      const next = ordered[index + 1];
      const from = Math.max(event.at, windowStart);
      const to = Math.min(next ? next.at : now, now);
      if (to <= from) return;
      segments.push({
        start: (from - windowStart) / windowMs,
        end: (to - windowStart) / windowMs,
        email: event.email,
        from,
        to
      });
    });
    return segments;
  }

  // src/identity.ts
  var ACCOUNT_COLORS = ["#853FD8", "#0E7A9B", "#D5217E", "#006CB4", "#A85334"];
  var accountKey = (email) => email.trim().toLowerCase();
  function hashSlot(key) {
    let hash = 0;
    for (const char of key) hash = hash * 31 + char.charCodeAt(0) >>> 0;
    return hash % ACCOUNT_COLORS.length;
  }
  function accountColor(slots, email) {
    const key = accountKey(email);
    const stored = slots[key];
    if (stored !== void 0 && ACCOUNT_COLORS[stored]) return ACCOUNT_COLORS[stored];
    const used = new Set(Object.values(slots));
    const free = ACCOUNT_COLORS.findIndex((_, index) => !used.has(index));
    return ACCOUNT_COLORS[free === -1 ? hashSlot(key) : free] ?? ACCOUNT_COLORS[0];
  }
  function monogram(email) {
    const at = email.lastIndexOf("@");
    const local = at > 0 ? email.slice(0, at) : email;
    const words = local.split(/[^\p{L}]+/u).filter(Boolean);
    return words.slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("").toLocaleUpperCase();
  }
  function initials(name) {
    return name.split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("").toLocaleUpperCase();
  }
  var NAME_MAX_LENGTH = 40;
  var UNSAFE_CHARACTERS = /[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
  function cleanName(raw) {
    const text = raw.replace(/\s+/g, " ").replace(UNSAFE_CHARACTERS, "").replace(/ {2,}/g, " ").trim();
    const characters = [...new Intl.Segmenter(void 0, { granularity: "grapheme" }).segment(text)].map((part) => part.segment);
    return characters.slice(0, NAME_MAX_LENGTH).join("").trim();
  }
  function nameFor(names2, email) {
    if (!email) return null;
    return names2[accountKey(email)] || null;
  }
  function accountLabel(names2, email) {
    const name = nameFor(names2, email);
    return name ? `${name} (${email})` : email;
  }
  function withName(names2, email, raw) {
    const key = accountKey(email);
    const name = cleanName(raw);
    const next = { ...names2 };
    delete next[key];
    if (name) next[key] = name;
    return next;
  }
  function pinState(pin, signedInEmail) {
    if (!pin) return "none";
    if (!signedInEmail) return "none";
    return sameAccount(pin, signedInEmail) ? "match" : "mismatch";
  }

  // src/dom.ts
  function el(tag, className = "", text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== void 0) element.textContent = text;
    return element;
  }
  function byId(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing #${id}`);
    return element;
  }
  var ICON_PATHS = {
    board: "M2.5 4h1.5M2.5 8h1.5M2.5 12h1.5M6.5 4h7M6.5 8h7M6.5 12h7",
    panel: "M3.5 2.5h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM9.5 2.5v11",
    copy: "M6.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM3.5 10.5h-.5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 .5.5v.5",
    done: "M3.5 8.5l3 3 6-7",
    pin: "M6.5 2.5h3V6l2 2.5V10h-7V8.5l2-2.5zM5.5 2.5h5M8 10v4",
    chevron: "M4.5 6.5L8 10l3.5-3.5",
    refresh: "M14 8a6 6 0 1 1-6-6c1.68 0 3.29.67 4.49 1.83L14 5.3M14 2v3.3h-3.3",
    alert: "M14.5 12L9.2 2.7a1.3 1.3 0 0 0-2.3 0L1.5 12a1.3 1.3 0 0 0 1.2 2h10.7a1.3 1.3 0 0 0 1.1-2zM8 6v2.7M8 11.3h.01",
    info: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v3.5M8 5h.01",
    user: "M8 8a2.75 2.75 0 1 0 0-5.5A2.75 2.75 0 0 0 8 8zM3 14c.7-2.6 2.7-4 5-4s4.3 1.4 5 4",
    history: "M2 8a6 6 0 1 0 6-6 6.5 6.5 0 0 0-4.49 1.83L2 5.3M2 2v3.3h3.3M8 4.7V8l2.7 1.3",
    settings: "M2.5 5h2M7.5 5h6M2.5 11h6M11.5 11h2M6 3.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM10 9.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z",
    download: "M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10"
  };
  function icon(name, className = "") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("icon", `icon-${name}`);
    if (className) svg.classList.add(className);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICON_PATHS[name]);
    svg.append(path);
    return svg;
  }
  function paintAvatar(host, email, color, name = null) {
    const letters = email ? name && initials(name) || monogram(email) : "";
    const key = `${email ?? ""}|${color ?? ""}|${name ?? ""}`;
    if (host.dataset.key === key) return;
    host.dataset.key = key;
    host.classList.toggle("avatar-empty", !email);
    if (email && color) host.style.setProperty("--avatar-color", color);
    else host.style.removeProperty("--avatar-color");
    host.replaceChildren(letters ? letters : icon("user"));
  }
  function avatar(email, color, name = null) {
    const host = el("span", "avatar");
    host.setAttribute("aria-hidden", "true");
    paintAvatar(host, email, color, name);
    return host;
  }
  var prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function settleIn(element) {
    if (prefersReducedMotion()) return;
    element.animate(
      [
        { opacity: 0, transform: "translateY(3px)" },
        { opacity: 1, transform: "none" }
      ],
      { duration: 240, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }
    );
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
  function homeUrl(m) {
    return `https://www.${m.domain}/`;
  }
  var OPENID_SELECT = encodeURIComponent("http://specs.openid.net/auth/2.0/identifier_select");
  var OPENID_NS = encodeURIComponent("http://specs.openid.net/auth/2.0");
  function switcherUrl(m) {
    const origin = `https://www.${m.domain}`;
    const returnTo = encodeURIComponent(`${origin}/?&ref_=nav_youraccount_switchacct`);
    return `${origin}/ap/signin?openid.pape.max_auth_age=0&openid.return_to=${returnTo}&openid.identity=${OPENID_SELECT}&openid.assoc_handle=${m.assocHandle}&openid.mode=checkid_setup&openid.claimed_id=${OPENID_SELECT}&openid.ns=${OPENID_NS}&ignoreAuthState=1&_encoding=UTF8`;
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
  function touchesAuthState(changedKeys) {
    return changedKeys.some(
      (key) => key === SELECTED_KEY || key === COLORS_KEY || key === NAMES_KEY || key.startsWith("auth:") || key.startsWith("pin:") || key.startsWith("history:")
    );
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
  function listOf(items) {
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
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
  function describe(record, m, now, checking2, pin = null) {
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
    if (checking2) freshness = "Checking\u2026";
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
  function boardRow(record, m, now, pin = null, names2 = {}) {
    const view = describe(record, m, now, false, pin);
    const email = record.status === "signed_in" ? record.email : null;
    const pinNote = view.pin.state === "mismatch" && pin ? `pinned account is ${accountLabel(names2, pin)}` : null;
    return {
      id: m.id,
      code: m.code,
      country: m.label,
      domain: m.domain,
      tone: view.tone,
      account: email ?? "",
      name: nameFor(names2, email),
      status: view.status,
      dim: isLastKnown(record, now),
      freshness: view.freshness,
      time: view.time,
      pin,
      pinState: view.pin.state,
      label: [m.domain, view.headline, email && accountLabel(names2, email), pinNote, view.freshness].filter(Boolean).join(", ")
    };
  }
  function boardSummary(records2, pins2 = []) {
    const signedIn = records2.filter((r) => r.status === "signed_in").length;
    const wrong = records2.filter((r, index) => pinState(pins2[index], r.status === "signed_in" ? r.email : null) === "mismatch").length;
    const summary2 = `${signedIn} of ${records2.length} marketplaces signed in`;
    return wrong ? `${summary2}, ${wrong} on the wrong account` : summary2;
  }

  // src/board.ts
  var NARROW_BELOW_PX = 900;
  var RELABEL_EVERY_MS = 3e4;
  var DAY2 = 24 * 36e5;
  var rowsHost = byId("rows");
  var axis = byId("axis");
  var accountsHost = byId("accounts");
  var summary = byId("summary");
  var checkAllButton = byId("check-all");
  var checkAllLabel = byId("check-all-label");
  var tooltip = byId("tooltip");
  var announce = byId("announce");
  var rows = /* @__PURE__ */ new Map();
  var checking = /* @__PURE__ */ new Set();
  var layout = "wide";
  var records = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, EMPTY_RECORD]));
  var pins = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, null]));
  var history = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, []]));
  var colors = {};
  var names = {};
  var colorOf = (email) => email ? accountColor(colors, email) : null;
  var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  function when(ms, now) {
    const sameDay = new Date(ms).toDateString() === new Date(now).toDateString();
    return sameDay ? clockTime(ms) : `yesterday ${clockTime(ms)}`;
  }
  function span(segment, ongoing, now) {
    return `${when(segment.from, now)} to ${ongoing ? "now" : when(segment.to, now)}`;
  }
  function layoutFor(width) {
    if (new URLSearchParams(location.search).get("view") === "panel") return "narrow";
    return width < NARROW_BELOW_PX ? "narrow" : "wide";
  }
  function applyLayout(next) {
    layout = next;
    document.body.classList.toggle("layout-wide", layout === "wide");
    document.body.classList.toggle("layout-narrow", layout === "narrow");
  }
  function buildRows() {
    for (const id of MARKETPLACE_IDS) {
      const m = MARKETPLACES[id];
      const element = el("li", "row");
      element.dataset.id = id;
      const code = el("span", "code", m.code);
      code.setAttribute("aria-hidden", "true");
      const marketText = el("span", "market-text");
      marketText.append(el("span", "market-name", m.label), el("span", "market-domain", m.domain));
      const market = el("div", "cell-market");
      market.append(code, marketText);
      const rowAvatar = avatar(null, null);
      const email = el("span", "account-email");
      const alt = el("span", "account-alt");
      alt.hidden = true;
      const sub = el("span", "account-sub");
      const accountText = el("span", "account-text");
      accountText.append(email, alt, sub);
      const account = el("div", "cell-account");
      account.append(rowAvatar, accountText);
      const pill = el("span", "pill");
      const dot = el("span", "dot");
      dot.setAttribute("aria-hidden", "true");
      const pillText = el("span");
      pill.append(dot, pillText);
      const freshness = el("span", "status-sub");
      const status = el("div", "cell-status");
      status.append(pill, freshness);
      const track = el("div", "track");
      track.setAttribute("role", "img");
      const timeline = el("div", "cell-timeline");
      timeline.append(track);
      const check = el("button", "icon-button row-check");
      check.type = "button";
      check.append(icon("refresh"));
      check.setAttribute("aria-label", `Check ${m.domain} now`);
      check.title = `Check ${m.domain} now`;
      const pin = el("button", "icon-button row-pin");
      pin.type = "button";
      pin.append(icon("pin"));
      pin.setAttribute("aria-label", `Pin the account on ${m.domain}`);
      const actions = el("div", "cell-actions");
      actions.append(check, pin);
      element.append(market, account, status, timeline, actions);
      rowsHost.append(element);
      const row = { element, account, avatar: rowAvatar, email, alt, sub, pill, pillText, freshness, track, check, pin, segments: [] };
      rows.set(id, row);
      check.addEventListener("click", () => void requestCheck(id));
      pin.addEventListener("click", () => {
        const record = records[id];
        if (pins[id]) void pinStore.set(id, null);
        else if (record.status === "signed_in" && record.email) void pinStore.set(id, record.email);
      });
      timeline.addEventListener("pointermove", (event) => showTooltip(row, event));
      timeline.addEventListener("pointerleave", () => hideTooltip(row));
    }
  }
  function buildAxis() {
    const labels = [
      [0, "24 h"],
      [25, "18 h"],
      [50, "12 h"],
      [75, "6 h"],
      [100, "Now"]
    ];
    axis.replaceChildren(
      ...labels.map(([percent, text]) => {
        const label = el("span", "", text);
        label.style.left = `${percent}%`;
        return label;
      })
    );
  }
  function renderTimeline(row, events, now) {
    row.segments = timelineSegments(events, now);
    row.track.replaceChildren(
      ...row.segments.map((segment) => {
        const part = el("span", segment.email ? "segment" : "segment out");
        part.classList.toggle("is-short", (segment.end - segment.start) * row.track.clientWidth < 6);
        part.style.left = `min(${segment.start * 100}%, calc(100% - 3px))`;
        part.style.width = `${(segment.end - segment.start) * 100}%`;
        const color = colorOf(segment.email);
        if (color) part.style.setProperty("--segment-color", color);
        return part;
      })
    );
    const spans = row.segments.map(
      (segment, index) => `${segment.email ? accountLabel(names, segment.email) : "signed out"} from ${span(segment, index === row.segments.length - 1, now)}`
    );
    row.track.setAttribute("aria-label", spans.length ? `Last 24 hours: ${spans.join("; ")}` : "No record in the last 24 hours");
  }
  function showTooltip(row, event) {
    const parts = [...row.track.children];
    let index = -1;
    let nearest = 4;
    parts.forEach((part, i) => {
      const box = part.getBoundingClientRect();
      const distance = event.clientX < box.left ? box.left - event.clientX : Math.max(0, event.clientX - box.right);
      if (distance <= nearest) {
        nearest = distance;
        index = i;
      }
    });
    const segment = row.segments[index];
    row.track.classList.toggle("is-hovering", Boolean(segment));
    parts.forEach((part, i) => part.classList.toggle("is-hover", i === index));
    if (!segment) {
      tooltip.hidden = true;
      return;
    }
    const now = Date.now();
    const who = el("div", "tooltip-who");
    const name = nameFor(names, segment.email);
    if (segment.email) who.append(avatar(segment.email, colorOf(segment.email), name), el("span", "", name ?? segment.email));
    else who.append("Signed out");
    tooltip.replaceChildren(who);
    if (segment.email && name) tooltip.append(el("div", "tooltip-email", segment.email));
    tooltip.append(el("div", "tooltip-when", span(segment, index === row.segments.length - 1, now)));
    tooltip.hidden = false;
    const rect = row.track.getBoundingClientRect();
    const tip = tooltip.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX - tip.width / 2, 8), window.innerWidth - tip.width - 8);
    const above = rect.top - tip.height - 10;
    const y = above >= 8 ? above : rect.bottom + 10;
    tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
  function hideTooltip(row) {
    tooltip.hidden = true;
    row.track.classList.remove("is-hovering");
  }
  function flash(element) {
    if (prefersReducedMotion()) return;
    element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 1800,
      easing: "cubic-bezier(0.4, 0, 0.6, 1)",
      pseudoElement: "::before"
    });
  }
  function accountLine(view, record) {
    if (view.account) return view.account;
    if (record.status === "signed_in") return "Email not shown";
    if (record.status === "signed_out") return "Not signed in";
    return record.problem ? "No answer yet" : "Not checked yet";
  }
  function renderRow(id, row, now, reason) {
    const record = records[id];
    const settled = boardRow(record, MARKETPLACES[id], now, pins[id], names);
    const isChecking = checking.has(id);
    const view = isChecking ? { ...settled, freshness: "Checking\u2026" } : settled;
    const previous = row.view;
    row.view = view;
    row.element.dataset.tone = view.tone;
    row.element.dataset.status = view.status;
    row.element.dataset.account = view.account;
    row.element.classList.toggle("is-off", !view.account);
    row.element.classList.toggle("is-dim", view.dim);
    paintAvatar(row.avatar, view.account || null, colorOf(view.account || null), view.name);
    row.email.textContent = view.name ?? accountLine(view, record);
    row.email.title = view.account ? accountLabel(names, view.account) : "";
    row.alt.textContent = view.name ? view.account : "";
    row.alt.hidden = !view.name;
    row.sub.replaceChildren();
    if (view.pinState === "mismatch" && view.pin) row.sub.append(icon("pin"), el("span", "", `Expected ${nameFor(names, view.pin) ?? view.pin}`));
    else if (view.pinState === "match") row.sub.append(icon("pin"), el("span", "", "Pinned"));
    row.sub.hidden = row.sub.childElementCount === 0;
    row.sub.title = view.pinState === "mismatch" && view.pin ? `Expected ${accountLabel(names, view.pin)}` : row.sub.textContent ?? "";
    row.pill.dataset.tone = view.tone;
    row.pillText.textContent = view.status;
    row.freshness.textContent = view.freshness;
    row.check.disabled = isChecking;
    row.check.querySelector(".icon")?.classList.toggle("spin", isChecking);
    const signedInEmail = record.status === "signed_in" ? record.email : null;
    row.pin.disabled = !pins[id] && !signedInEmail;
    row.pin.setAttribute("aria-pressed", String(Boolean(pins[id])));
    const pinned = pins[id];
    row.pin.title = pinned ? `Pinned to ${accountLabel(names, pinned)}. Click to unpin.` : signedInEmail ? `Expect ${accountLabel(names, signedInEmail)} on ${view.domain}` : "Sign in to pin an account";
    renderTimeline(row, history[id], now);
    const changed = previous !== void 0 && (previous.status !== view.status || previous.account !== view.account);
    if (reason === "live" && changed) {
      flash(row.element);
      settleIn(row.account);
      announce.textContent = `${view.domain}: ${view.status}${view.account ? `, ${accountLabel(names, view.account)}` : ""}`;
    }
  }
  function renderAccounts(now) {
    const accounts = /* @__PURE__ */ new Map();
    const entry = (email) => {
      const key = accountKey(email);
      const existing = accounts.get(key) ?? { email, signedIn: [], pinned: [], seen: false };
      accounts.set(key, existing);
      return existing;
    };
    for (const id of MARKETPLACE_IDS) {
      const record = records[id];
      if (record.status === "signed_in" && record.email) entry(record.email).signedIn.push(MARKETPLACES[id].code);
      const pin = pins[id];
      if (pin) entry(pin).pinned.push(MARKETPLACES[id].code);
      for (const event of history[id]) if (event.email && now - event.at < DAY2) entry(event.email).seen = true;
    }
    for (const id of MARKETPLACE_IDS) {
      for (const segment of timelineSegments(history[id], now)) if (segment.email) entry(segment.email).seen = true;
    }
    if (accounts.size === 0) {
      accountsHost.replaceChildren(el("li", "accounts-empty", "No accounts yet. Sign in on any Amazon marketplace and it shows up here."));
      return;
    }
    const order = (e) => colors[accountKey(e.email)] ?? Number.MAX_SAFE_INTEGER;
    accountsHost.replaceChildren(
      ...[...accounts.values()].sort((a, b) => order(a) - order(b) || a.email.localeCompare(b.email)).map(({ email, signedIn, pinned }) => {
        const item = el("li", "account");
        const facts = [
          signedIn.length ? `Signed in on ${listOf(signedIn)}` : null,
          pinned.length ? `Pinned to ${listOf(pinned)}` : null
        ].filter(Boolean);
        const where = facts.length ? `${facts.join(". ")}.` : "Seen in the last 24 hours.";
        const name = nameFor(names, email);
        const body = el("div");
        body.append(el("p", "account-name", name ?? email));
        if (name) body.append(el("p", "account-alt", email));
        body.append(el("p", "account-where", where));
        item.append(avatar(email, colorOf(email), name), body);
        return item;
      })
    );
  }
  function render(reason) {
    const now = Date.now();
    for (const id of MARKETPLACE_IDS) {
      const row = rows.get(id);
      if (row) renderRow(id, row, now, reason);
    }
    summary.textContent = boardSummary(
      MARKETPLACE_IDS.map((id) => records[id]),
      MARKETPLACE_IDS.map((id) => pins[id])
    );
    renderAccounts(now);
  }
  async function reload() {
    [records, pins, history, colors, names] = await Promise.all([
      authStore.getAll(),
      pinStore.getAll(),
      historyStore.getAll(),
      colorStore.get(),
      nameStore.get()
    ]);
  }
  async function requestCheck(id) {
    checking.add(id);
    render("tick");
    try {
      const request = { type: "check", marketplace: id, force: true };
      await chrome.runtime.sendMessage(request);
    } catch (error) {
      console.warn("Check did not finish", id, error);
    } finally {
      checking.delete(id);
      await reload();
      render("live");
    }
  }
  async function checkAll() {
    checkAllButton.disabled = true;
    checkAllButton.querySelector(".icon")?.classList.add("spin");
    for (const [index, id] of MARKETPLACE_IDS.entries()) {
      checkAllLabel.textContent = `Checking ${index + 1} of ${MARKETPLACE_IDS.length}`;
      await requestCheck(id);
      await sleep(300);
    }
    checkAllButton.querySelector(".icon")?.classList.remove("spin");
    checkAllButton.disabled = false;
    checkAllLabel.textContent = "Check all";
  }
  async function init() {
    applyLayout(layoutFor(window.innerWidth));
    buildRows();
    buildAxis();
    checkAllButton.prepend(icon("refresh"));
    byId("open-settings").append(icon("settings"));
    await reload();
    render("initial");
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !touchesAuthState(Object.keys(changes))) return;
      void reload().then(() => render("live"));
    });
    checkAllButton.addEventListener("click", () => void checkAll());
    setInterval(() => render("tick"), RELABEL_EVERY_MS);
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const next = layoutFor(window.innerWidth);
        if (next !== layout) applyLayout(next);
      }, 120);
    });
  }
  void init();
})();
