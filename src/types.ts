export type AuthStatus = 'signed_in' | 'signed_out' | 'unknown';

/** Why the latest attempt could not give a full answer. */
export type CheckProblem = 'network' | 'challenge' | 'unrecognised' | 'email_unavailable';

export interface AuthRecord {
  /** Last conclusive answer. A failed check never turns this into signed_out. */
  status: AuthStatus;
  /** Account identifier shown by Amazon. Usually an email; a phone-only account shows its number. */
  email: string | null;
  /** When Amazon or the cookie jar last gave a conclusive answer. */
  confirmedAt: number | null;
  /** When a check last ran, conclusive or not. */
  attemptedAt: number | null;
  problem: CheckProblem | null;
  /** Hash of the auth cookie. When it changes, the account may have changed too. */
  sessionKey: string | null;
  emailCheckedAt: number | null;
}

export const EMPTY_RECORD: AuthRecord = {
  status: 'unknown',
  email: null,
  confirmedAt: null,
  attemptedAt: null,
  problem: null,
  sessionKey: null,
  emailCheckedAt: null,
};

/** One change of who is signed in on a marketplace. `email` is null while signed out. */
export interface HistoryEvent {
  at: number;
  email: string | null;
}

export interface PageResponse {
  status: number;
  finalUrl: string;
  wafAction: string | null;
  html: string;
}
