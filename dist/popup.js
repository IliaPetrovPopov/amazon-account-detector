"use strict";
(() => {
  // src/history.ts
  var HOUR = 36e5;
  var HISTORY_RETENTION_MS = 7 * 24 * HOUR;
  var TIMELINE_WINDOW_MS = 24 * HOUR;
  function identityOf(record) {
    if (record.problem !== null && record.problem !== "email_unavailable") return void 0;
    if (record.status === "signed_out") return { email: null };
    if (record.status === "signed_in" && record.email) return { email: record.email };
    return void 0;
  }
  function sameAccount(a, b) {
    if (a === null || b === null) return a === b;
    return a.trim().toLowerCase() === b.trim().toLowerCase();
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
  function setText(element, text) {
    element.textContent = text ?? "";
    element.hidden = text === null;
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
    history: "M2 8a6 6 0 1 0 6-6 6.5 6.5 0 0 0-4.49 1.83L2 5.3M2 2v3.3h3.3M8 4.7V8l2.7 1.3"
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
  function setIcon(host, name) {
    const current = host.querySelector("svg.icon");
    const next = icon(name);
    if (current) current.replaceWith(next);
    else host.prepend(next);
  }
  function paintAvatar(host, email, color) {
    const letters = email ? monogram(email) : "";
    const key = `${email ?? ""}|${color ?? ""}`;
    if (host.dataset.key === key) return;
    host.dataset.key = key;
    host.classList.toggle("avatar-empty", !email);
    if (email && color) host.style.setProperty("--avatar-color", color);
    else host.style.removeProperty("--avatar-color");
    host.replaceChildren(letters ? letters : icon("user"));
  }
  function avatar(email, color, className = "") {
    const host = el("span", `avatar${className ? ` ${className}` : ""}`);
    host.setAttribute("aria-hidden", "true");
    paintAvatar(host, email, color);
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
  var memory = {
    read(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    write(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
      }
    }
  };

  // src/listbox.ts
  function comboKey(key, open, active2, count, altKey = false) {
    const last = count - 1;
    if (!open) {
      switch (key) {
        case "ArrowDown":
        case "ArrowUp":
        case "Enter":
        case " ":
          return { type: "open", active: active2 };
        case "Home":
          return { type: "open", active: 0 };
        case "End":
          return { type: "open", active: last };
        default:
          return { type: "none" };
      }
    }
    switch (key) {
      case "ArrowDown":
        return { type: "move", active: Math.min(active2 + 1, last) };
      case "ArrowUp":
        return altKey ? { type: "select", index: active2 } : { type: "move", active: Math.max(active2 - 1, 0) };
      case "Home":
      case "PageUp":
        return { type: "move", active: 0 };
      case "End":
      case "PageDown":
        return { type: "move", active: last };
      case "Enter":
      case " ":
      case "Tab":
        return { type: "select", index: active2 };
      case "Escape":
        return { type: "close" };
      default:
        return { type: "none" };
    }
  }
  function typeahead(labels, typed2, from) {
    const query = typed2.trim().toLowerCase();
    if (!query) return -1;
    for (let step = 1; step <= labels.length; step += 1) {
      const index = (from + step) % labels.length;
      const words = (labels[index] ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u);
      if (words.some((word) => word.startsWith(query))) return index;
    }
    return -1;
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
  var authKey = (id) => `auth:${id}`;
  var pinKey = (id) => `pin:${id}`;
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
  var colorStore = {
    async get() {
      const found = await chrome.storage.local.get(COLORS_KEY);
      return found[COLORS_KEY] ?? {};
    },
    async set(slots) {
      await chrome.storage.local.set({ [COLORS_KEY]: slots });
    }
  };
  async function loadSelectedMarketplace() {
    const found = await chrome.storage.local.get(SELECTED_KEY);
    const value = found[SELECTED_KEY];
    return isMarketplaceId(value) ? value : "com";
  }
  async function saveSelectedMarketplace(id) {
    await chrome.storage.local.set({ [SELECTED_KEY]: id });
  }
  function touchesAuthState(changedKeys) {
    return changedKeys.some(
      (key) => key === SELECTED_KEY || key === COLORS_KEY || key.startsWith("auth:") || key.startsWith("pin:") || key.startsWith("history:")
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
    let account2 = null;
    let action2 = null;
    switch (record.status) {
      case "signed_in":
        if (pinned === "mismatch") {
          tone = "alert";
          status = "Wrong account";
          headline = lastKnown ? "Last known: wrong account" : "Wrong account";
          action2 = { label: "Switch account", url: switcherUrl(m), primary: true };
        } else {
          tone = lastKnown ? "warn" : "ok";
          status = lastKnown ? "Last known" : "Signed in";
          headline = lastKnown ? "Last known: signed in" : "Signed in";
        }
        account2 = record.email ?? "Email not available";
        break;
      case "signed_out":
        tone = lastKnown ? "warn" : "off";
        status = lastKnown ? "Last known" : "Signed out";
        headline = lastKnown ? "Last known: not signed in" : "Not signed in";
        action2 = { label: `Sign in on ${m.domain}`, url: switcherUrl(m), primary: true };
        break;
      default:
        tone = record.problem ? "warn" : "off";
        status = record.problem ? "No answer" : "Not checked";
        headline = record.problem ? "Could not check" : "Not checked yet";
    }
    if (record.problem === "challenge") action2 = { label: `Open ${m.domain}`, url: homeUrl(m), primary: false };
    let freshness2 = "";
    if (checking2) freshness2 = "Checking\u2026";
    else if (age !== null) freshness2 = `${lastKnown ? "Last confirmed" : "Checked"} ${formatAge(age)}`;
    return {
      tone,
      status,
      headline,
      account: account2,
      accountMuted: lastKnown || record.email === null,
      notice: noticeFor(record.problem, m),
      freshness: freshness2,
      time: record.confirmedAt === null ? null : clockTime(record.confirmedAt),
      action: action2,
      pin: { state: pinned, email: pin }
    };
  }
  function heroText(record, m) {
    if (record.status === "signed_in" && record.email) {
      const [local, domain] = emailLines(record.email);
      return { primary: local, secondary: domain || m.domain, email: record.email };
    }
    if (record.status === "signed_in") return { primary: "Signed in", secondary: "Amazon did not show the email", email: null };
    if (record.status === "signed_out") return { primary: "Not signed in", secondary: m.domain, email: null };
    return { primary: record.problem ? "No answer from Amazon" : "Not checked yet", secondary: m.domain, email: null };
  }
  function lookOf(record) {
    return identityOf(record) ?? null;
  }
  function changeNote(previous, record) {
    const current = identityOf(record);
    if (!previous || !current || sameAccount(previous.email, current.email)) return null;
    if (previous.email === null) return { text: "Signed in since you last looked", before: null };
    if (current.email === null) return { text: "Signed out since you last looked", before: previous.email };
    return { text: "Account changed since you last looked", before: previous.email };
  }
  function boardRow(record, m, now, pin = null) {
    const view = describe(record, m, now, false, pin);
    const email = record.status === "signed_in" ? record.email : null;
    const pinNote = view.pin.state === "mismatch" ? `pinned account is ${pin}` : null;
    return {
      id: m.id,
      code: m.code,
      country: m.label,
      domain: m.domain,
      tone: view.tone,
      account: email ?? "",
      status: view.status,
      dim: isLastKnown(record, now),
      freshness: view.freshness,
      time: view.time,
      pin,
      pinState: view.pin.state,
      label: [m.domain, view.headline, email, pinNote, view.freshness].filter(Boolean).join(", ")
    };
  }
  function emailLines(email) {
    const at = email.lastIndexOf("@");
    if (at <= 0) return [email, ""];
    return [email.slice(0, at), email.slice(at)];
  }

  // src/popup.ts
  var SHOW_CHECKING_AFTER_MS = 200;
  var RELABEL_EVERY_MS = 3e4;
  var SEEN_KEY = "popup:seen";
  var TYPEAHEAD_RESET_MS = 700;
  var combo = byId("combo");
  var comboCode = byId("combo-code");
  var comboName = byId("combo-name");
  var comboDomain = byId("combo-domain");
  var comboDot = byId("combo-dot");
  var listbox = byId("listbox");
  var identity = byId("identity");
  var avatarHost = byId("avatar");
  var primary = byId("primary");
  var secondary = byId("secondary");
  var account = byId("account");
  var statusPill = byId("status");
  var statusText = byId("status-text");
  var freshness = byId("freshness");
  var changeBox = byId("change");
  var changeText = byId("change-text");
  var changeBefore = byId("change-before");
  var alertBox = byId("alert");
  var alertText = byId("alert-text");
  var alertWho = byId("alert-who");
  var repinButton = byId("repin");
  var noticeBox = byId("notice-box");
  var notice = byId("notice");
  var action = byId("action");
  var checkButton = byId("check");
  var checkLabel = byId("check-label");
  var copyButton = byId("copy");
  var pinButton = byId("pin");
  var pinLabel = byId("pin-label");
  var announce = byId("announce");
  var options = /* @__PURE__ */ new Map();
  var searchLabels = MARKETPLACE_IDS.map((id) => `${MARKETPLACES[id].code} ${MARKETPLACES[id].label} ${MARKETPLACES[id].domain}`);
  var selected = "com";
  var records = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, EMPTY_RECORD]));
  var pins = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, null]));
  var colors = {};
  var checking = /* @__PURE__ */ new Set();
  var notes = {};
  var shownKey = "";
  var windowId;
  var copiedTimer;
  var listOpen = false;
  var active = 0;
  var typed = "";
  var typedTimer;
  var colorOf = (email) => email ? accountColor(colors, email) : null;
  function buildOptions() {
    MARKETPLACE_IDS.forEach((id, index) => {
      const m = MARKETPLACES[id];
      const element = el("li", "option");
      element.id = `option-${id.replace(".", "-")}`;
      element.dataset.id = id;
      element.setAttribute("role", "option");
      const code = el("span", "code", m.code);
      code.setAttribute("aria-hidden", "true");
      const text = el("span", "option-text");
      text.setAttribute("aria-hidden", "true");
      text.append(el("span", "option-name", m.label), el("span", "option-domain", m.domain));
      const accountBox = el("span", "option-account");
      accountBox.setAttribute("aria-hidden", "true");
      const dot = el("span", "dot");
      const optionAvatar = avatar(null, null);
      const accountText = el("span");
      accountBox.append(dot, optionAvatar, accountText);
      element.append(code, text, accountBox);
      element.addEventListener("mousedown", (event) => event.preventDefault());
      element.addEventListener("mousemove", () => {
        if (active !== index) setActive(index);
      });
      element.addEventListener("click", () => {
        closeList();
        choose(id);
      });
      listbox.append(element);
      options.set(id, { element, dot, avatar: optionAvatar, account: accountText });
    });
  }
  function setActive(index) {
    active = index;
    MARKETPLACE_IDS.forEach((id, i) => options.get(id)?.element.classList.toggle("is-active", i === index));
    const option = options.get(MARKETPLACE_IDS[index] ?? selected);
    if (!option) return;
    combo.setAttribute("aria-activedescendant", option.element.id);
    option.element.scrollIntoView({ block: "nearest" });
  }
  function openList(index) {
    if (!listOpen) {
      listOpen = true;
      listbox.hidden = false;
      combo.setAttribute("aria-expanded", "true");
      const bottom = Math.ceil(listbox.getBoundingClientRect().bottom + window.scrollY + 16);
      if (bottom > document.documentElement.scrollHeight) document.body.style.minHeight = `${bottom}px`;
      if (!prefersReducedMotion()) {
        listbox.animate(
          [
            { opacity: 0, transform: "translateY(-4px)" },
            { opacity: 1, transform: "none" }
          ],
          { duration: 140, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }
        );
      }
    }
    setActive(index);
  }
  function closeList() {
    listOpen = false;
    typed = "";
    listbox.hidden = true;
    combo.setAttribute("aria-expanded", "false");
    combo.removeAttribute("aria-activedescendant");
    document.body.style.minHeight = "";
  }
  function onComboKey(event) {
    const current = MARKETPLACE_IDS.indexOf(selected);
    const from = listOpen ? active : current;
    const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (printable && !(event.key === " " && typed === "")) {
      event.preventDefault();
      clearTimeout(typedTimer);
      typed += event.key;
      typedTimer = setTimeout(() => typed = "", TYPEAHEAD_RESET_MS);
      const match = typeahead(searchLabels, typed, typed.length > 1 ? from - 1 : from);
      if (match >= 0) openList(match);
      return;
    }
    const result = comboKey(event.key, listOpen, from, MARKETPLACE_IDS.length, event.altKey);
    if (result.type === "none") return;
    if (event.key !== "Tab") event.preventDefault();
    switch (result.type) {
      case "open":
        openList(result.active);
        break;
      case "move":
        setActive(result.active);
        break;
      case "select": {
        closeList();
        const id = MARKETPLACE_IDS[result.index];
        if (id) choose(id);
        break;
      }
      case "close":
        closeList();
        break;
    }
  }
  function renderCombo(now) {
    const m = MARKETPLACES[selected];
    comboCode.textContent = m.code;
    comboName.textContent = m.label;
    comboDomain.textContent = m.domain;
    for (const id of MARKETPLACE_IDS) {
      const option = options.get(id);
      if (!option) continue;
      const row = boardRow(records[id], MARKETPLACES[id], now, pins[id]);
      const email = row.account || null;
      option.element.setAttribute("aria-selected", String(id === selected));
      option.element.setAttribute("aria-label", `${row.country}, ${row.label}`);
      option.element.dataset.tone = row.tone;
      option.dot.dataset.tone = row.tone;
      option.avatar.hidden = email === null;
      paintAvatar(option.avatar, email, colorOf(email));
      option.account.textContent = email ? emailLines(email)[0] : row.status;
      option.element.querySelector(".code")?.classList.toggle("is-current", id === selected);
      if (id === selected) comboDot.dataset.tone = row.tone;
    }
  }
  function render(reason) {
    const now = Date.now();
    const m = MARKETPLACES[selected];
    const record = records[selected];
    const pin = pins[selected];
    const isChecking = checking.has(selected);
    const view = describe(record, m, now, isChecking, pin);
    const hero = heroText(record, m);
    renderCombo(now);
    paintAvatar(avatarHost, hero.email, colorOf(hero.email));
    primary.textContent = hero.primary;
    secondary.textContent = hero.secondary;
    identity.classList.toggle("is-faded", hero.email !== null && view.accountMuted);
    account.textContent = `${m.domain}: ${view.headline}${hero.email ? `, ${hero.email}` : ""}`;
    statusPill.dataset.tone = view.tone;
    statusText.textContent = view.status;
    freshness.textContent = view.freshness;
    const key = `${selected}|${hero.primary}|${hero.secondary}|${view.status}`;
    const changed = shownKey !== "" && key !== shownKey;
    if (changed && reason === "live") notes[selected] = null;
    if (changed && (reason === "live" || reason === "choose")) announce.textContent = account.textContent;
    if (changed && reason !== "tick" || reason === "open" && notes[selected]) settleIn(identity);
    shownKey = key;
    const note = notes[selected];
    changeBox.hidden = !note;
    if (note) {
      changeText.textContent = note.text;
      changeBefore.hidden = !note.before;
      if (note.before) changeBefore.replaceChildren("Before:", avatar(note.before, colorOf(note.before)), el("span", "", note.before));
    }
    const mismatch = view.pin.state === "mismatch" && view.pin.email;
    alertBox.hidden = !mismatch;
    if (mismatch && view.pin.email) {
      alertText.textContent = `${m.domain} is pinned to`;
      alertWho.replaceChildren(avatar(view.pin.email, colorOf(view.pin.email)), el("span", "alert-email", view.pin.email));
    }
    noticeBox.hidden = view.notice === null;
    setText(notice, view.notice);
    action.hidden = !view.action;
    if (view.action) {
      action.textContent = view.action.label;
      action.href = view.action.url;
      action.dataset.primary = String(view.action.primary);
      action.classList.toggle("button-primary", view.action.primary);
    }
    checkButton.disabled = isChecking;
    checkLabel.textContent = isChecking ? "Checking\u2026" : "Check now";
    checkButton.querySelector(".icon")?.classList.toggle("spin", isChecking);
    copyButton.hidden = !hero.email;
    pinButton.hidden = !hero.email;
    if (hero.email) {
      const pinnedHere = view.pin.state === "match";
      pinButton.setAttribute("aria-pressed", String(pinnedHere));
      pinButton.setAttribute("aria-label", `Pin this account to ${m.domain}`);
      pinButton.title = pinnedHere ? `Pinned to ${m.domain}. Click to unpin.` : `Expect this account on ${m.domain}`;
      pinLabel.textContent = pinnedHere ? "Pinned" : "Pin account";
    }
    const look = lookOf(record);
    if (look) {
      const seen = memory.read(SEEN_KEY, {});
      seen[selected] = look;
      memory.write(SEEN_KEY, seen);
    }
  }
  async function reload() {
    [records, pins, colors] = await Promise.all([authStore.getAll(), pinStore.getAll(), colorStore.get()]);
  }
  async function requestCheck(id, force) {
    const showChecking = setTimeout(() => {
      checking.add(id);
      render("tick");
    }, SHOW_CHECKING_AFTER_MS);
    try {
      const request = { type: "check", marketplace: id, force };
      await chrome.runtime.sendMessage(request);
    } catch (error) {
      console.warn("Check did not finish", id, error);
    } finally {
      clearTimeout(showChecking);
      checking.delete(id);
      await reload();
      render("live");
    }
  }
  function choose(id) {
    if (id === selected) return;
    selected = id;
    void saveSelectedMarketplace(id);
    render("choose");
    void requestCheck(id, false);
  }
  function buildTools() {
    byId("open-board").append(icon("board"));
    byId("open-panel").append(icon("panel"));
    byId("combo-chevron").append(icon("chevron"));
    byId("change-icon").append(icon("history"));
    byId("alert-icon").append(icon("alert"));
    byId("notice-icon").append(icon("info"));
    copyButton.append(icon("copy"));
    checkButton.prepend(icon("refresh"));
    pinButton.prepend(icon("pin"));
    byId("open-board").addEventListener("click", () => {
      void chrome.tabs.create({ url: chrome.runtime.getURL("board.html") }).then(() => window.close());
    });
    byId("open-panel").addEventListener("click", () => {
      if (windowId === void 0) return;
      chrome.sidePanel.open({ windowId }).then(() => window.close()).catch((error) => console.warn("Side panel did not open", error));
    });
    combo.addEventListener("click", () => {
      if (listOpen) closeList();
      else openList(MARKETPLACE_IDS.indexOf(selected));
    });
    combo.addEventListener("keydown", onComboKey);
    combo.addEventListener("blur", () => {
      if (listOpen) closeList();
    });
    checkButton.addEventListener("click", () => void requestCheck(selected, true));
    copyButton.addEventListener("click", () => {
      const email = records[selected].email;
      if (!email) return;
      void navigator.clipboard.writeText(email).then(() => {
        setIcon(copyButton, "done");
        copyButton.classList.add("is-done");
        copyButton.setAttribute("aria-label", "Email copied");
        announce.textContent = "Email copied";
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
          setIcon(copyButton, "copy");
          copyButton.classList.remove("is-done");
          copyButton.setAttribute("aria-label", "Copy email");
        }, 1500);
      });
    });
    const pinCurrent = () => {
      const email = records[selected].status === "signed_in" ? records[selected].email : null;
      if (email) void pinStore.set(selected, email);
    };
    pinButton.addEventListener("click", () => {
      if (pinButton.getAttribute("aria-pressed") === "true") void pinStore.set(selected, null);
      else pinCurrent();
    });
    repinButton.addEventListener("click", pinCurrent);
  }
  async function init() {
    buildOptions();
    buildTools();
    selected = await loadSelectedMarketplace();
    await reload();
    const seen = memory.read(SEEN_KEY, {});
    notes = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, changeNote(seen[id], records[id])]));
    render("open");
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !touchesAuthState(Object.keys(changes))) return;
      void reload().then(() => render("live"));
    });
    setInterval(() => render("tick"), RELABEL_EVERY_MS);
    void chrome.windows.getCurrent().then((window2) => {
      windowId = window2.id;
    });
    void requestCheck(selected, false);
  }
  void init();
})();
