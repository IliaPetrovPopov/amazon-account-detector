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
  function withName(names2, email, raw) {
    const key = accountKey(email);
    const name = cleanName(raw);
    const next = { ...names2 };
    delete next[key];
    if (name) next[key] = name;
    return next;
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
  var OPENID_SELECT = encodeURIComponent("http://specs.openid.net/auth/2.0/identifier_select");
  var OPENID_NS = encodeURIComponent("http://specs.openid.net/auth/2.0");

  // src/alerts.ts
  var TEST_ALERT_ID = "alert:test";

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

  // src/export.ts
  var CSV_HEADER = ["Marketplace", "State", "Account", "Nickname", "From", "To"];
  var FORMULA_START = /^[=+\-@\t\r]/;
  function csvCell(value) {
    const safe = FORMULA_START.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }
  var pad = (value) => String(value).padStart(2, "0");
  function localTimestamp(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function historyCsv(history2, names2) {
    const lines = [CSV_HEADER];
    for (const id of MARKETPLACE_IDS) {
      const events = [...history2[id]].sort((a, b) => a.at - b.at);
      events.forEach((event, index) => {
        const next = events[index + 1];
        lines.push([
          MARKETPLACES[id].domain,
          event.email ? "Signed in" : "Signed out",
          event.email ?? "",
          nameFor(names2, event.email) ?? "",
          localTimestamp(event.at),
          next ? localTimestamp(next.at) : ""
        ]);
      });
    }
    return `\uFEFF${lines.map((cells) => cells.map(csvCell).join(",")).join("\r\n")}\r
`;
  }
  function csvFileName(now) {
    const d = new Date(now);
    return `amazon-accounts-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.csv`;
  }
  function historyStats(history2) {
    const events = MARKETPLACE_IDS.flatMap((id) => history2[id]);
    const since2 = events.length ? Math.min(...events.map((event) => event.at)) : null;
    return { periods: events.length, since: since2 };
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
  function clockTime(ms) {
    const date = new Date(ms);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  function dayAndTime(ms, now) {
    if (sameDay(ms, now)) return `today ${clockTime(ms)}`;
    if (sameDay(ms, now - DAY)) return `yesterday ${clockTime(ms)}`;
    const date = new Date(ms);
    return `${date.getDate()} ${MONTHS[date.getMonth()]} ${clockTime(ms)}`;
  }
  function listOf(items) {
    if (items.length <= 1) return items.join("");
    return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
  }

  // src/options.ts
  var SAVED_FOR_MS = 1600;
  var namesHost = byId("names");
  var alertsSwitch = byId("alerts-switch");
  var testAlertButton = byId("test-alert");
  var testAlertLabel = byId("test-alert-label");
  var historySummary = byId("history-summary");
  var exportButton = byId("export");
  var announce = byId("announce");
  var rows = /* @__PURE__ */ new Map();
  var records = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, EMPTY_RECORD]));
  var pins = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, null]));
  var history = Object.fromEntries(MARKETPLACE_IDS.map((id) => [id, []]));
  var colors = {};
  var names = {};
  var alertsOn = false;
  var saving = Promise.resolve();
  var testSentTimer;
  function knownAccounts() {
    const emails = /* @__PURE__ */ new Map();
    const note = (email) => {
      if (email && !emails.has(accountKey(email))) emails.set(accountKey(email), email.trim());
    };
    for (const id of MARKETPLACE_IDS) {
      note(records[id].status === "signed_in" ? records[id].email : null);
      note(pins[id]);
      for (const event of history[id]) note(event.email);
    }
    Object.keys(colors).forEach(note);
    Object.keys(names).forEach(note);
    const order = (key) => colors[key] ?? Number.MAX_SAFE_INTEGER;
    return [...emails.entries()].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b)).map(([key, email]) => ({ key, email }));
  }
  function whereText(key, now) {
    const signedIn = [];
    const pinned = [];
    let lastSeen = null;
    for (const id of MARKETPLACE_IDS) {
      const record = records[id];
      if (record.status === "signed_in" && record.email && accountKey(record.email) === key) signedIn.push(MARKETPLACES[id].code);
      const pin = pins[id];
      if (pin && accountKey(pin) === key) pinned.push(MARKETPLACES[id].code);
      const events = [...history[id]].sort((a, b) => a.at - b.at);
      events.forEach((event, index) => {
        if (!event.email || accountKey(event.email) !== key) return;
        const end = events[index + 1]?.at ?? now;
        lastSeen = Math.max(lastSeen ?? 0, end);
      });
    }
    const facts = [
      signedIn.length ? `Signed in on ${listOf(signedIn)}` : null,
      pinned.length ? `Pinned to ${listOf(pinned)}` : null
    ].filter(Boolean);
    if (facts.length) return `${facts.join(". ")}.`;
    if (lastSeen !== null) return `Last signed in ${dayAndTime(lastSeen, now)}.`;
    return "Not seen in the last 30 days.";
  }
  function showSaved(row, message) {
    row.saved.classList.add("is-visible");
    announce.textContent = message;
    clearTimeout(row.savedTimer);
    row.savedTimer = setTimeout(() => row.saved.classList.remove("is-visible"), SAVED_FOR_MS);
  }
  function save(row) {
    const raw = row.input.value;
    saving = saving.then(async () => {
      const before = nameFor(names, row.email) ?? "";
      if (cleanName(raw) === before) {
        row.input.value = before;
        return;
      }
      names = await nameStore.set(row.email, raw);
      const after = nameFor(names, row.email) ?? "";
      row.input.value = after;
      paintAvatar(row.avatar, row.email, accountColor(colors, row.email), after || null);
      showSaved(row, after ? `Nickname saved: ${after}` : `Nickname removed for ${row.email}`);
    }).catch((error) => console.warn("Nickname not saved", error));
    return saving;
  }
  function buildNameRow(key, email) {
    const element = el("li", "name-row");
    element.dataset.key = key;
    const rowAvatar = avatar(email, accountColor(colors, email), nameFor(names, email));
    const who = el("div", "name-who");
    const where = el("p", "name-where");
    who.append(el("p", "name-email", email), where);
    const field = el("div", "name-field");
    const input = el("input", "input");
    input.type = "text";
    input.placeholder = "Add a nickname";
    input.maxLength = NAME_MAX_LENGTH * 2;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", `Nickname for ${email}`);
    input.setAttribute("aria-describedby", "names-help");
    const saved = el("span", "name-saved");
    saved.setAttribute("aria-hidden", "true");
    saved.append(icon("done"), el("span", "", "Saved"));
    field.append(input, saved);
    element.append(rowAvatar, who, field);
    const row = { key, email, element, avatar: rowAvatar, where, input, saved };
    input.addEventListener("change", () => void save(row));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void save(row);
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.value = nameFor(names, email) ?? "";
        input.blur();
      }
    });
    return row;
  }
  function renderNames(now) {
    const accounts = knownAccounts();
    if (accounts.length === 0) {
      rows.clear();
      namesHost.replaceChildren(el("li", "names-empty", "No accounts yet. Sign in on any Amazon marketplace and it shows up here."));
      return;
    }
    namesHost.querySelector(".names-empty")?.remove();
    const wanted = new Set(accounts.map((account) => account.key));
    for (const [key, row] of rows) {
      if (!wanted.has(key)) {
        row.element.remove();
        rows.delete(key);
      }
    }
    accounts.forEach(({ key, email }, index) => {
      let row = rows.get(key);
      if (!row) {
        row = buildNameRow(key, email);
        rows.set(key, row);
      }
      if (namesHost.children[index] !== row.element) namesHost.insertBefore(row.element, namesHost.children[index] ?? null);
      const name = nameFor(names, email);
      paintAvatar(row.avatar, email, accountColor(colors, email), name);
      row.where.textContent = whereText(key, now);
      if (document.activeElement !== row.input) row.input.value = name ?? "";
    });
  }
  function renderAlerts() {
    alertsSwitch.setAttribute("aria-checked", String(alertsOn));
    testAlertButton.disabled = !alertsOn;
  }
  async function toggleAlerts() {
    alertsOn = !alertsOn;
    renderAlerts();
    await alertStore.set(alertsOn);
    announce.textContent = alertsOn ? "Desktop alerts on" : "Desktop alerts off";
  }
  async function sendTestAlert() {
    try {
      await chrome.notifications.create(TEST_ALERT_ID, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: "Alerts are on",
        message: "This is how a sign-out or the wrong account will show. Nothing changed on Amazon.",
        priority: 1
      });
      testAlertLabel.textContent = "Test alert sent";
      announce.textContent = "Test alert sent";
    } catch (error) {
      console.warn("Test alert failed", error);
      testAlertLabel.textContent = "Chrome could not show it";
      announce.textContent = "Chrome could not show the test alert";
    }
    clearTimeout(testSentTimer);
    testSentTimer = setTimeout(() => testAlertLabel.textContent = "Send a test alert", 2500);
  }
  function since(ms, now) {
    const text = dayAndTime(ms, now);
    if (text.startsWith("today ")) return `since ${clockTime(ms)}`;
    if (text.startsWith("yesterday ")) return `since ${text}`;
    return `since ${text.slice(0, text.lastIndexOf(" "))}`;
  }
  function renderHistory(now) {
    const { periods, since: oldest } = historyStats(history);
    exportButton.disabled = periods === 0;
    historySummary.textContent = periods === 0 || oldest === null ? "No history yet" : `${periods} ${periods === 1 ? "change" : "changes"} ${since(oldest, now)}`;
  }
  function exportHistory() {
    const csv = historyCsv(history, names);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = el("a");
    link.href = url;
    link.download = csvFileName(Date.now());
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1e4);
    announce.textContent = "History exported";
  }
  async function reload() {
    [records, pins, history, colors, names, alertsOn] = await Promise.all([
      authStore.getAll(),
      pinStore.getAll(),
      historyStore.getAll(),
      colorStore.get(),
      nameStore.get(),
      alertStore.enabled()
    ]);
  }
  function render() {
    const now = Date.now();
    renderNames(now);
    renderAlerts();
    renderHistory(now);
  }
  async function init() {
    byId("open-board").prepend(icon("board"));
    exportButton.prepend(icon("download"));
    await reload();
    render();
    alertsSwitch.addEventListener("click", () => void toggleAlerts());
    testAlertButton.addEventListener("click", () => void sendTestAlert());
    exportButton.addEventListener("click", exportHistory);
    chrome.storage.onChanged.addListener((changes, area) => {
      const keys = Object.keys(changes);
      if (area !== "local" || !(touchesAuthState(keys) || keys.includes(ALERTS_KEY))) return;
      void reload().then(render);
    });
  }
  void init();
})();
