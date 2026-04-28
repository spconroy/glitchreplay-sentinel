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

Initial Sentinel bridge is wired. Report Issue still creates a GitHub
issue first; after that succeeds, Sentinel opportunistically calls
`window.glitchreplay.reportQA(...)` in the reviewed page. If the
helper is not present, Sentinel falls back to GitHub-only reporting.

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

### In Sentinel

The bridge between Sentinel's "Report Issue" flow and the page's SDK
is implemented in `src/main/main.js`. Sentinel runs JavaScript inside
the active webview after the GitHub issue is created:

```js
const result = await webview.executeJavaScript(`
  window.glitchreplay && typeof window.glitchreplay.reportQA === "function"
    ? window.glitchreplay.reportQA({
        notes,
        reviewer,
        source: "sentinel",
        evidence,
        extra: { githubIssueUrl, screenshot }
      })
    : null
`);
```

Conceptually, the payload is:

```js
window.glitchreplay.reportQA({
    notes,
    reviewer,
    source: "sentinel",
    evidence,
    extra: {
      pageUrl,
      githubIssueUrl,
      screenshot,
    },
});
```

`reportQA` returns `{ eventId }` synchronously; Sentinel can stash
that on the QA page record and surface it in the UI.

## Reviewer identity (required)

Every QA report needs to be attributable to a reviewer — without it,
you can't tell "Sean's reports" from "Maria's reports" in the
GlitchReplay dashboard, and you can't bulk-filter spam from a single
machine if it ever happens.

Sentinel captures the reviewer name once and passes it on every
report. It defaults from `gh api user --jq '.login'`, stores the value
in `data/profile.json`, and exposes an editable Reviewer field in the
app sidebar.

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

Settings UI: a single text field in Sentinel's sidebar. Empty value
skips the GlitchReplay path and still allows GitHub issue creation.

The same reviewer name should appear in the GitHub issue body
(e.g. "Reported by sean@example.com via Sentinel") so the two
systems stay cross-referenced.

## Recommended UX in Sentinel

When the reviewer clicks **Report Issue**:

1. **Create GitHub issue.** This remains the required reporting path.
2. **If GlitchReplay is loaded:** dual-write by default —
   call `reportQA()` with notes, reviewer, evidence, GitHub issue URL,
   and screenshot reference.
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

- Per-project Sentinel config: do we want a
  `glitchreplay: { enabled: true }` toggle, or always attempt the
  bridge and let presence-detection silently fall through?
- When the bridge succeeds, do we want to skip console-errors /
  network-failures in the GitHub issue body (they're already in
  GlitchReplay) or keep both for redundancy?
