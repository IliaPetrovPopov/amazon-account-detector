"use strict";
(() => {
  // src/classify.ts
  function readEmail(doc) {
    const fromClaim = doc.querySelector("input#ap-claim")?.getAttribute("value")?.trim();
    const fromHint = doc.querySelector("[data-claim]")?.getAttribute("data-claim")?.trim();
    return fromClaim || fromHint || null;
  }

  // src/offscreen.ts
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.target !== "offscreen") return false;
    const doc = new DOMParser().parseFromString(message.html, "text/html");
    sendResponse(readEmail(doc));
    return false;
  });
})();
