import { readEmail } from './classify';
import type { ExtractEmailRequest } from './messages';

chrome.runtime.onMessage.addListener((message: ExtractEmailRequest, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;
  const doc = new DOMParser().parseFromString(message.html, 'text/html');
  sendResponse(readEmail(doc));
  return false;
});
