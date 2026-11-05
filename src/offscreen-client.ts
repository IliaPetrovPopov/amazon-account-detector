import type { ExtractEmailRequest } from './messages';

const OFFSCREEN_URL = 'offscreen.html';

// Chrome allows one offscreen document at a time, so parse requests run in turn.
let queue: Promise<unknown> = Promise.resolve();

async function ensureDocument(): Promise<void> {
  // A worker that died mid-parse can leave a document behind.
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [chrome.offscreen.Reason.DOM_PARSER],
    justification: 'Read the account email from Amazon sign-in HTML. Service workers have no DOMParser.',
  });
}

/** Service workers have no DOMParser, so the browser's own parser runs in an offscreen document. */
export function extractEmailOffscreen(html: string): Promise<string | null> {
  const run = queue.then(async () => {
    await ensureDocument();
    try {
      const request: ExtractEmailRequest = { target: 'offscreen', html };
      const email: string | null = await chrome.runtime.sendMessage(request);
      return email;
    } finally {
      await chrome.offscreen.closeDocument();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}
