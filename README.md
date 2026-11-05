<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/board-dark.png">
    <img src="docs/board.png" width="100%" alt="The live board: all five Amazon marketplaces with the signed-in account, its status and a 24-hour timeline of who was signed in when">
  </picture>
</p>

<h1 align="center">Amazon Account Detector</h1>

<p align="center">See which Amazon account is signed in on every marketplace, live, without touching your tabs.</p>

<p align="center">
  <img src="https://img.shields.io/badge/Chrome-Manifest_V3-0065FD" alt="Chrome Manifest V3">
  <img src="https://img.shields.io/badge/TypeScript-strict-16203B" alt="TypeScript strict">
  <img src="https://img.shields.io/badge/unit_tests-267-16A34A" alt="267 unit tests">
  <img src="https://img.shields.io/badge/end--to--end-47_scenarios-16A34A" alt="47 end-to-end scenarios">
  <img src="https://img.shields.io/badge/runtime_dependencies-0-16203B" alt="No runtime dependencies">
</p>

## Install

Requires Chrome 116 or newer. No build step: the built extension is in `dist/`.

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and choose the `dist` folder.
4. Pin **Amazon Account Detector** from the extensions menu so its icon stays in the toolbar.

To build it yourself, with Node 22 or newer: `npm install`, then `npm run build` writes the same `dist/`.

## Try the marketplace check

1. Click the toolbar icon and pick a marketplace from the dropdown. The last known state shows at once with its age, and a check runs if it is more than 5 minutes old. **Check now** always checks.
2. To watch it change live, open the board in Chrome's side panel (the panel icon in the popup header). It stays open while you browse, which the popup does not.
3. Sign in on that marketplace in any tab. Within a few seconds the board, and the popup the next time you open it, show the email.
4. Sign out in that tab. The marketplace switches to **Not signed in** by itself, without a request to Amazon. (With two saved accounts, Amazon's Sign Out switches to the other account instead, and the extension follows.)
5. An answer older than 90 minutes, or one whose latest check failed, is labelled **Last known**, so old data never looks current.

<p align="center">
  <img src="docs/popup-light.png" width="240" alt="Popup: signed in on amazon.co.uk with a pinned account">
  <img src="docs/popup-menu.png" width="240" alt="The marketplace dropdown, showing the account on every marketplace">
  <img src="docs/popup-alert.png" width="240" alt="Popup in dark mode: the wrong account is signed in on amazon.de, with a switch button">
</p>

## How the brief is covered

| The brief asks for | How it is met |
| --- | --- |
| A popup dropdown to pick the marketplace | Toolbar popup with all five marketplaces in a dropdown that also works by keyboard and screen reader |
| Signed in or not, and the email | The session is confirmed on Your Account. The email is read from the sign-in page in the brief (`input#ap-claim`) |
| No interference with the tabs you are using | No tabs, iframes or content scripts. The service worker fetches with your cookies, and the extension has no `tabs`, `scripting` or `activeTab` permission |
| Cached state, with clear freshness | Saved per marketplace and shown at once with its age. Labelled **Last known** after 90 minutes or a failed check |
| Correct after logout or session expiry | A cookie change triggers a recheck within about 1.5 seconds. An expired session is caught on Your Account. A slow reply can never bring back the email of an old session |
| The sign-in URL, with the right `openid.assoc_handle` | `usflex` for the US, `gbflex` UK, `deflex` DE, `itflex` IT, `frflex` FR, each checked on the real site (`usflex` returns 404 outside amazon.com). A test pins the URL to the brief's, character for character |
| A repository that loads unpacked | The built extension is committed in `dist/`, and `npm run verify` fails if it differs from the source |

## Beyond the brief

- **Live board** of all five marketplaces, in a tab or Chrome's side panel (the list and panel icons in the popup header), with a 24-hour timeline of who was signed in when.
- **Wrong-account alarm:** pin the account a marketplace should use. The popup, the board and the toolbar badge turn red if another account is signed in.
- **Account colours and initials,** the same on every screen, and a note when the account changed since you last looked.
- **Toolbar badge** with the marketplace's state, and `amz` plus a space in the address bar for every account at once.
- **Settings** (the sliders icon): nicknames for accounts, always shown next to the email; desktop alerts when a marketplace signs out or the wrong account signs in, off until you turn them on; and a CSV export of 30 days of history.

## How it works

No tabs, iframes or content scripts. The service worker reads the marketplace's auth cookie (none means signed out, with no request), confirms the session on the Your Account page, and reads the email from the sign-in page in the brief only for a new session or once a day. A cookie change triggers a recheck, an hourly alarm refreshes the rest, and a challenge or an error never reads as signed out.

- **Stack:** TypeScript (strict), bundled by esbuild into a service worker and four small pages with plain DOM and no runtime dependencies, so the popup opens instantly. Vitest for unit tests, and Chrome for Testing driven over the DevTools Protocol for end-to-end tests.
- **Permissions:** `cookies`, `storage`, `alarms`, `offscreen` (to parse HTML), `sidePanel`, `notifications` (only for alerts you turn on), and access to the five Amazon sites.
- **Privacy:** nothing is sent anywhere except the checks to Amazon. Everything stays on this computer, in the extension's own storage, which is never synced.
- **Known limits:** a real server-side expiry was not triggered on Amazon; the fake Amazon and the unit tests cover it. "Signed in" means Amazon recognises the session, and Amazon may still ask for the password before it shows orders.

The full write-up, with the reasons for each choice, what the real sites showed, the design and every limit, is in [docs/how-it-works.md](docs/how-it-works.md). To read the code, start with `src/check.ts` (one check), `src/classify.ts` (how a page is judged) and `src/service.ts` (one check at a time, and the late-reply guard).

## Tests

```sh
npm test         # 267 unit tests
npm run e2e      # 47 scenarios: the built extension in a real Chrome against a local fake Amazon
npm run verify   # types, unit tests, a fresh build, and a check that dist/ matches the source
```

The end-to-end run needs Chrome for Testing, because branded Chrome ignores `--load-extension`. `npx @puppeteer/browsers install chrome@stable` downloads it and prints its path. Pass that path as `CHROME_PATH`, for example `CHROME_PATH="/path/to/Google Chrome for Testing" npm run e2e`.
