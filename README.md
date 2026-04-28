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

Initial bridge included. Design details are in [`docs/glitchreplay.md`](docs/glitchreplay.md). The GlitchReplay-side helper (`@glitchreplay/qa-report`) exposes `window.glitchreplay.reportQA(...)` on any page that's wired it into its `Sentry.init`.

When **Report Issue** creates a GitHub issue, Sentinel also tries to call `window.glitchreplay.reportQA(...)` inside the reviewed page. If the helper is present, GlitchReplay receives the QA report and links it to the active replay. If it is absent, Sentinel falls back to GitHub-only reporting.

### Reviewer name

Sentinel captures a reviewer name once, defaults it from `gh api user --jq '.login'`, stores it in `data/profile.json`, includes it in GitHub issue bodies, and passes it to GlitchReplay as `reportQA({ reviewer })`.
