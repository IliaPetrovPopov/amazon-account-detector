import { identityOf, sameAccount } from './history';
import { accountLabel, nameFor, pinState, type AccountNames, type PinState } from './identity';
import { homeUrl, switcherUrl, type Marketplace, type MarketplaceId } from './marketplaces';
import type { AuthRecord, CheckProblem } from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Past the hourly refresh with room to spare, so routine timing does not flip the label. */
export const STALE_AFTER_MS = 90 * MINUTE;

/** ok: confirmed and fine. off: not signed in. warn: not current. alert: the wrong account. */
export type Tone = 'ok' | 'off' | 'warn' | 'alert';

export interface PopupView {
  tone: Tone;
  /** The state in a few words, for the status pill. */
  status: string;
  /** The state as a phrase, for tooltips and screen readers. */
  headline: string;
  account: string | null;
  /** Shown faded: the account is not a current answer, or there is no email to show. */
  accountMuted: boolean;
  notice: string | null;
  freshness: string;
  /** Clock time of the last confirmed answer. */
  time: string | null;
  action: { label: string; url: string; primary: boolean } | null;
  pin: { state: PinState; email: string | null };
}

export function formatAge(ms: number): string {
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(ms / DAY);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Zero-padded 24-hour clock time. */
export function clockTime(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** "today 14:02", "yesterday 09:15" or "3 Nov 09:15". */
export function dayAndTime(ms: number, now: number): string {
  if (sameDay(ms, now)) return `today ${clockTime(ms)}`;
  if (sameDay(ms, now - DAY)) return `yesterday ${clockTime(ms)}`;
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${clockTime(ms)}`;
}

/** "UK", "UK and IT", "UK, DE and IT". */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function noticeFor(problem: CheckProblem | null, m: Marketplace): string | null {
  switch (problem) {
    case 'network':
      return 'Could not reach Amazon. Check your connection and try again.';
    case 'challenge':
      return `Amazon asked for a browser check. Open ${m.domain} once, then check again.`;
    case 'unrecognised':
      return 'Amazon returned a page this extension does not recognise.';
    case 'email_unavailable':
      return 'Amazon did not show the email on this check.';
    default:
      return null;
  }
}

/** Not current: too old, or the latest attempt to confirm it failed. */
export function isLastKnown(record: AuthRecord, now: number): boolean {
  const age = record.confirmedAt === null ? null : now - record.confirmedAt;
  const failed = record.problem !== null && record.problem !== 'email_unavailable';
  return (age !== null && age > STALE_AFTER_MS) || failed;
}

/** Turns a record into what the popup says. Anything not freshly confirmed is labelled as such. */
export function describe(
  record: AuthRecord,
  m: Marketplace,
  now: number,
  checking: boolean,
  pin: string | null = null,
): PopupView {
  const age = record.confirmedAt === null ? null : now - record.confirmedAt;
  const lastKnown = isLastKnown(record, now);
  const signedInEmail = record.status === 'signed_in' ? record.email : null;
  const pinned = pinState(pin, signedInEmail);

  let tone: Tone = 'off';
  let status: string;
  let headline: string;
  let account: string | null = null;
  let action: PopupView['action'] = null;

  switch (record.status) {
    case 'signed_in':
      if (pinned === 'mismatch') {
        tone = 'alert';
        status = 'Wrong account';
        headline = lastKnown ? 'Last known: wrong account' : 'Wrong account';
        action = { label: 'Switch account', url: switcherUrl(m), primary: true };
      } else {
        tone = lastKnown ? 'warn' : 'ok';
        status = lastKnown ? 'Last known' : 'Signed in';
        headline = lastKnown ? 'Last known: signed in' : 'Signed in';
      }
      account = record.email ?? 'Email not available';
      break;
    case 'signed_out':
      tone = lastKnown ? 'warn' : 'off';
      status = lastKnown ? 'Last known' : 'Signed out';
      headline = lastKnown ? 'Last known: not signed in' : 'Not signed in';
      action = { label: `Sign in on ${m.domain}`, url: switcherUrl(m), primary: true };
      break;
    default:
      tone = record.problem ? 'warn' : 'off';
      status = record.problem ? 'No answer' : 'Not checked';
      headline = record.problem ? 'Could not check' : 'Not checked yet';
  }

  if (record.problem === 'challenge') action = { label: `Open ${m.domain}`, url: homeUrl(m), primary: false };

  let freshness = '';
  if (checking) freshness = 'Checking…';
  else if (age !== null) freshness = `${lastKnown ? 'Last confirmed' : 'Checked'} ${formatAge(age)}`;

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
    pin: { state: pinned, email: pin },
  };
}

export interface Hero {
  /** The large line: the nickname, the part of the email before the @, or the state. */
  primary: string;
  /** The small line under it. With a nickname, the whole email, so the email always shows. */
  secondary: string;
  /** The account, when one is signed in and Amazon showed it. */
  email: string | null;
  /** The account's nickname, if it has one. */
  name: string | null;
}

/** The popup's main lines. The email is split at the @, so the part that tells accounts apart leads. */
export function heroText(record: AuthRecord, m: Marketplace, names: AccountNames = {}): Hero {
  if (record.status === 'signed_in' && record.email) {
    const name = nameFor(names, record.email);
    if (name) return { primary: name, secondary: record.email, email: record.email, name };
    const [local, domain] = emailLines(record.email);
    return { primary: local, secondary: domain || m.domain, email: record.email, name: null };
  }
  const none = { email: null, name: null };
  if (record.status === 'signed_in') return { primary: 'Signed in', secondary: 'Amazon did not show the email', ...none };
  if (record.status === 'signed_out') return { primary: 'Not signed in', secondary: m.domain, ...none };
  return { primary: record.problem ? 'No answer from Amazon' : 'Not checked yet', secondary: m.domain, ...none };
}

/** What the popup remembers about a marketplace between looks: who was signed in, or null while signed out. */
export interface Look {
  email: string | null;
}

export function lookOf(record: AuthRecord): Look | null {
  return identityOf(record) ?? null;
}

/** A note for the popup when the account changed while it was closed. */
export function changeNote(previous: Look | null | undefined, record: AuthRecord): { text: string; before: string | null } | null {
  const current = identityOf(record);
  if (!previous || !current || sameAccount(previous.email, current.email)) return null;
  if (previous.email === null) return { text: 'Signed in since you last looked', before: null };
  if (current.email === null) return { text: 'Signed out since you last looked', before: previous.email };
  return { text: 'Account changed since you last looked', before: previous.email };
}

export interface BoardRowView {
  id: MarketplaceId;
  code: string;
  country: string;
  domain: string;
  tone: Tone;
  /** The signed-in account, or empty. */
  account: string;
  /** The signed-in account's nickname, if it has one. */
  name: string | null;
  /** One or two words for the status column. */
  status: string;
  /** Faded: not current. */
  dim: boolean;
  freshness: string;
  /** Clock time of the last confirmed answer. */
  time: string | null;
  pin: string | null;
  pinState: PinState;
  /** The whole row as one sentence, for screen readers. */
  label: string;
}

export function boardRow(
  record: AuthRecord,
  m: Marketplace,
  now: number,
  pin: string | null = null,
  names: AccountNames = {},
): BoardRowView {
  const view = describe(record, m, now, false, pin);
  const email = record.status === 'signed_in' ? record.email : null;
  const pinNote = view.pin.state === 'mismatch' && pin ? `pinned account is ${accountLabel(names, pin)}` : null;
  return {
    id: m.id,
    code: m.code,
    country: m.label,
    domain: m.domain,
    tone: view.tone,
    account: email ?? '',
    name: nameFor(names, email),
    status: view.status,
    dim: isLastKnown(record, now),
    freshness: view.freshness,
    time: view.time,
    pin,
    pinState: view.pin.state,
    label: [m.domain, view.headline, email && accountLabel(names, email), pinNote, view.freshness].filter(Boolean).join(', '),
  };
}

export function boardSummary(records: AuthRecord[], pins: Array<string | null> = []): string {
  const signedIn = records.filter((r) => r.status === 'signed_in').length;
  const wrong = records.filter((r, index) => pinState(pins[index], r.status === 'signed_in' ? r.email : null) === 'mismatch').length;
  const summary = `${signedIn} of ${records.length} marketplaces signed in`;
  return wrong ? `${summary}, ${wrong} on the wrong account` : summary;
}

export interface BadgeView {
  text: string;
  color: string;
  textColor: string;
  title: string;
}

const BADGE_COLORS: Record<Tone, { color: string; textColor: string }> = {
  ok: { color: '#16A34A', textColor: '#FFFFFF' },
  off: { color: '#5B6B86', textColor: '#FFFFFF' },
  warn: { color: '#F5C24B', textColor: '#16203B' },
  alert: { color: '#DC2626', textColor: '#FFFFFF' },
};

/** The toolbar badge: the chosen marketplace's code, coloured by its state. */
export function badgeView(
  record: AuthRecord,
  m: Marketplace,
  now: number,
  pin: string | null = null,
  names: AccountNames = {},
): BadgeView {
  const view = describe(record, m, now, false, pin);
  const who = record.status === 'signed_in' && record.email ? ` as ${accountLabel(names, record.email)}` : '';
  const pinNote = view.pin.state === 'mismatch' && pin ? `\nPinned account: ${accountLabel(names, pin)}` : '';
  return {
    text: m.code,
    ...BADGE_COLORS[view.tone],
    title: `Amazon Account Detector\n${m.domain}: ${view.headline}${who}${pinNote}`,
  };
}

/** Splits an email at the last @: the part that tells accounts apart, and the domain. */
export function emailLines(email: string): [string, string] {
  const at = email.lastIndexOf('@');
  if (at <= 0) return [email, ''];
  return [email.slice(0, at), email.slice(at)];
}
