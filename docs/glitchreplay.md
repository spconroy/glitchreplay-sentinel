# GlitchReplay integration

Sentinel can file bug reports straight into [GlitchReplay](https://glitchreplay.com)
with the active session replay automatically attached — no DSN, auth
token, or replay upload needed on Sentinel's side.

The trick: if the page being reviewed already has the GlitchReplay
SDK loaded, **the replay is already being captured and uploaded.**
Sentinel just needs to call into the page to file an event that
references the in-flight session, and GlitchReplay's existing pipeline
handles the rest.

## Status

Not yet wired up in Sentinel — this doc is the plan for adding it.
The GlitchReplay-side helper landed in
`@glitchreplay/qa-report` v0.1.0 (commit `c6ad29b` on
`spconroy/glitchreplay.com`).

## What runs on each side

### On the customer's site (one-time setup, customer's responsibility)

```ts
import * as Sentry from "@sentry/nextjs";
import { qaReportIntegration } from "@glitchreplay/qa-report";

Sentry.init({
  dsn: "https://<key>@glitchreplay.com/0",
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
    qaReportIntegration(),
  ],
});
```

Effect: `window.glitchreplay.reportQA(...)` becomes available on every
page once the SDK has set up.

### In Sentinel's webview preload

The bridge between Sentinel's "Report Issue" flow and the page's SDK
goes in `src/preload/qa-spy.js` (or a sibling preload). Pseudocode:

```js
// Detect presence first — fall back to GitHub-only if absent.
function hasGlitchReplay() {
  return typeof window.glitchreplay?.reportQA === "function";
}

async function sendToGlitchReplay({ notes, reviewer, evidence }) {
  if (!hasGlitchReplay()) return null;
  return window.glitchreplay.reportQA({
    notes,
    reviewer,
    source: "sentinel",
    evidence,
  });
}
```

Sentinel's main process invokes the bridge through the webview:

```js
// In src/main/main.js, alongside the existing reportIssue handler.
const result = await webview.executeJavaScript(`
  window.glitchreplay && typeof window.glitchreplay.reportQA === "function"
    ? window.glitchreplay.reportQA(${JSON.stringify(payload)})
    : null
`);
```

`reportQA` returns `{ eventId }` synchronously; Sentinel can stash
that on the QA page record and surface it in the UI.

## Reviewer identity (required)

Every QA report needs to be attributable to a reviewer — without it,
you can't tell "Sean's reports" from "Maria's reports" in the
GlitchReplay dashboard, and you can't bulk-filter spam from a single
machine if it ever happens.

Capture the reviewer name once and pass it on every report. Two ways
in Sentinel:

1. **First-run dialog.** On the first launch (no reviewer in app
   config yet), prompt: "What name or email should appear on QA
   reports you file?" Persist to `data/profile.json` or similar.
2. **Auto-detect from `gh auth status`.** Sentinel already requires
   the GitHub CLI for issue creation. `gh api user --jq '.login'`
   gives the GitHub login; use that as the default and let the user
   override in settings.

The captured value flows into every report:

```js
const reviewer = profile.reviewer; // from data/profile.json

window.glitchreplay.reportQA({
  notes,
  reviewer,
  source: "sentinel",
  evidence,
});
```

Settings UI: a single text field in Sentinel's project / app
settings. Editable any time. Empty value should disable the
"Send to GlitchReplay" path — better to fail loudly than file
anonymous reports.

The same reviewer name should appear in the GitHub issue body
(e.g. "Reported by sean@example.com via Sentinel") so the two
systems stay cross-referenced.

## Recommended UX in Sentinel

When the reviewer clicks **Report Issue**:

1. **Detect.** Run a presence check via
   `webview.executeJavaScript("typeof window.glitchreplay?.reportQA === 'function'")`.
2. **If GlitchReplay is loaded:** offer dual-write by default —
   create the GitHub issue (existing flow) AND call `reportQA()`.
   GitHub gets the human-readable ticket; GlitchReplay gets the
   replay-linked event for the dashboard.
3. **If GlitchReplay is not loaded:** silently fall through to the
   existing GitHub-only flow. Optionally surface a one-line tip in
   the project settings ("This site doesn't have GlitchReplay
   installed — replays won't be linked to your reports.").

Sentinel never needs its own DSN or project config for this. The
customer's site is the source of truth.

## What ends up in GlitchReplay

A regular issue with:

- `error_type: "qa_report"` (filterable in the issues list).
- The reviewer's notes as the title.
- Tags: `glitchreplay.qa_source=sentinel`,
  `glitchreplay.qa_reviewer=<reviewer>`.
- `contexts.qa_report` containing notes, reviewer, page URL, and
  the full evidence packet (console errors, network failures,
  recorded steps, any extra metadata).
- The active session replay, linked through the SDK's normal
  replay-id tagging.

## Cross-linking back to Sentinel / GitHub

`reportQA` returns the GlitchReplay event id. Two practical uses:

- Embed it in the GitHub issue body, so the GH ticket links to the
  GlitchReplay dashboard:
  `https://glitchreplay.com/projects/<project>/events/<eventId>`.
- Stash it on the QA page record so re-reviews see "previously
  reported as `<eventId>`."

## Privacy

Per-project replay privacy levels (`strict` / `balanced` / `light` /
`none`) are applied by the SDK at capture time. A `strict` site will
either capture a heavily masked replay or none at all — the QA report
itself still files successfully.

PII scrub on the GlitchReplay side runs against the event payload, so
sensitive strings in reviewer notes or evidence are redacted before
storage.

## Open questions

- Should Sentinel default to dual-write (GitHub + GlitchReplay) or
  let the reviewer pick per-report?
- Per-project Sentinel config: do we want a
  `glitchreplay: { enabled: true }` toggle, or always attempt the
  bridge and let presence-detection silently fall through?
- When the bridge succeeds, do we want to skip console-errors /
  network-failures in the GitHub issue body (they're already in
  GlitchReplay) or keep both for redundancy?
