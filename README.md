# Sitemap Sentinel

Desktop QA workflow for reviewing sitemap pages, discovering missing app routes, and creating GitHub issues with screenshot and browser evidence.

## Quick Start

```bash
npm install
cp config/projects.example.json config/projects.json
gh auth login
npm run dev
```

For production-style local startup:

```bash
npm run build
npm start
```

## Configure Projects

Edit `config/projects.json`.

Each project needs:

- `rootUrl`: site or app root.
- `mode`: `sitemap`, `discover`, or `hybrid`.
- `githubRepo`: target repo in `owner/repo` format.
- `sitemaps`: sitemap URLs for sitemap/hybrid mode.
- `seedUrls`: starting URLs for discover mode.

The app supports grouping multiple projects under one brand, such as `example.com` and `app.example.com`.

## GitHub Issues

Clicking **Report Issue** captures:

- Screenshot.
- Reviewer notes.
- Console errors and warnings.
- Navigation/load failures.
- Browser metadata.
- Recent recorded interaction steps.

The app creates the issue with `gh issue create --repo <owner/repo>`.

Screenshots are saved under `screenshots/`. If the QA repo has a GitHub `origin` remote, the issue body includes a raw GitHub URL for the screenshot path. After Git sync pushes the screenshot, that image can render in the issue.

## Sync

QA progress is saved locally immediately. Git sync stages `config`, `data`, and `screenshots`, then commits and pushes after:

- 10 processed pages.
- 600 seconds of inactivity.
- App exit.
- Manual **Sync now**.

Default branch strategy is per-user, such as `qa/sean`.

## GlitchReplay integration

Planned. Design + bridge code in [`docs/glitchreplay.md`](docs/glitchreplay.md). The GlitchReplay-side helper (`@glitchreplay/qa-report`) is shipped and exposes `window.glitchreplay.reportQA(...)` on any page that's wired it into its `Sentry.init`.

### TODO: reviewer name capture

Before wiring up the GlitchReplay path, Sentinel needs a reviewer-identity field — a name or email captured once and forwarded on every report. Without it, all QA reports surface as `(anonymous)` in the GlitchReplay dashboard and there's no way to bulk-filter by reviewer.

Concrete pieces:

- [ ] First-run dialog: "What name or email should appear on QA reports you file?" Persist to `data/profile.json` (or similar).
- [ ] Default to `gh api user --jq '.login'` since `gh` auth is already required.
- [ ] Settings UI: a single editable text field. Empty value should disable the GlitchReplay report path (fail loudly rather than file anonymous).
- [ ] Plumb the captured value into `reportIssue` so it ends up in both the GitHub issue body ("Reported by …") and the `reportQA({ reviewer })` call.

Once that's in, the bridge described in `docs/glitchreplay.md` can be wired into the existing **Report Issue** flow.
