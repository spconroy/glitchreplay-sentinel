# GlitchReplay Sentinel

Free, open-source desktop QA workflow for reviewing every page on a website, using sitemaps and link discovery to find the pages, and filing rich GitHub issues with screenshot and browser evidence.

Sentinel is built for human QA. It gives reviewers one place to load every page, approve pages that pass, and report pages that fail. When a site also has the GlitchReplay QA helper installed, Sentinel can dual-write the report into GlitchReplay so the active replay is attached automatically.

## What It Does

- Discovers website pages from sitemaps, including sitemap indexes.
- Supports discover mode for apps without sitemaps by scraping internal links from pages as the reviewer browses.
- Tracks review status locally: pending, approved, issue, updated, skipped, ignored.
- Flags pages for re-review when sitemap `lastmod` is newer than the last QA inspection.
- Captures screenshots, console warnings/errors, load failures, browser metadata, and recent reviewer interactions.
- Creates GitHub issues through the system-installed GitHub CLI.
- Saves QA state as JSON files in the repo.
- Syncs `config`, `data`, and `screenshots` through Git.
- Optionally calls `window.glitchreplay.reportQA(...)` on reviewed pages that have the GlitchReplay helper installed.

## Requirements

- Node.js 20 or newer.
- npm.
- Git.
- GitHub CLI (`gh`).
- A GitHub account with permission to create issues in the target repos.

Authenticate GitHub CLI before reporting issues:

```bash
gh auth login
```

## Install

For now, Sentinel runs from source. Signed installers are intentionally deferred.

```bash
git clone https://github.com/spconroy/glitchreplay-sentinel.git
cd glitchreplay-sentinel
npm install
cp config/projects.example.json config/projects.json
npm run dev
```

For production-style local startup:

```bash
npm run build
npm start
```

To update:

```bash
git pull
npm install
```

## Configure Projects

Edit `config/projects.json`.

Each project needs:

- `id`: stable project id.
- `name`: display name.
- `rootUrl`: site or app root.
- `mode`: `sitemap`, `discover`, or `hybrid`.
- `githubRepo`: target repo in `owner/repo` format.
- `sitemaps`: sitemap URLs for sitemap/hybrid mode.
- `seedUrls`: starting URLs for discover mode.

Example:

```json
{
  "schemaVersion": 1,
  "sync": {
    "enabled": true,
    "batchPageCount": 10,
    "inactivitySeconds": 600,
    "branchStrategy": "per-user",
    "branchPrefix": "qa"
  },
  "discovery": {
    "queryStringMode": "strip-tracking",
    "trackingParams": ["utm_*", "fbclid", "gclid", "msclkid"]
  },
  "brands": [
    {
      "id": "example-brand",
      "name": "Example Brand",
      "projects": [
        {
          "id": "marketing",
          "name": "Marketing Site",
          "rootUrl": "https://example.com",
          "sitemaps": ["https://example.com/sitemap.xml"],
          "mode": "hybrid",
          "githubRepo": "owner/marketing-repo",
          "labels": ["qa", "website"],
          "webviewPartition": "persist:example-brand"
        },
        {
          "id": "app",
          "name": "App",
          "rootUrl": "https://app.example.com",
          "sitemaps": [],
          "seedUrls": ["https://app.example.com/dashboard"],
          "mode": "discover",
          "githubRepo": "owner/app-repo",
          "labels": ["qa", "app"],
          "webviewPartition": "persist:example-brand",
          "recordActions": true
        }
      ]
    }
  ]
}
```

The app supports grouping multiple projects under one brand, such as `example.com` and `app.example.com`.

## Review Workflow

1. Start Sentinel.
2. Pick a brand and project.
3. Confirm the Reviewer field is correct.
4. Select a page from the Needs Review queue.
5. Review the page in the embedded browser.
6. Click **Approve** if it passes.
7. Add notes and click **Report Issue** if it fails.
8. Use **Skip** for pages you cannot review yet.
9. Use **Ignore** for pages that should stay out of normal queues.

## GitHub Issues

Clicking **Report Issue** captures:

- Screenshot.
- Reviewer notes.
- Console warnings and errors.
- Navigation/load failures.
- Browser metadata.
- Recent recorded interaction steps.

The app creates the issue with:

```bash
gh issue create --repo <owner/repo>
```

Screenshots are saved under `screenshots/`. If the QA repo has a GitHub `origin` remote, the issue body includes a raw GitHub URL for the screenshot path. After Git sync pushes the screenshot, that image can render in the issue.

## Reviewer Name

Sentinel captures a reviewer name once, defaults it from:

```bash
gh api user --jq '.login'
```

The value is stored in `data/profile.json`, shown in the sidebar, included in GitHub issue bodies, and passed to GlitchReplay as `reportQA({ reviewer })` when the GlitchReplay bridge is available.

## Git Sync

QA progress is saved locally immediately. Git sync stages:

- `config`
- `data`
- `screenshots`

Sync runs after:

- 10 processed pages.
- 600 seconds of inactivity.
- App exit.
- Manual **Sync now**.

Default branch strategy is per-user, such as `qa/sean`. This reduces conflicts when multiple reviewers use the same QA repo.

## GlitchReplay Integration

Sentinel does not need a GlitchReplay DSN or API key.

If the reviewed page has the GlitchReplay QA helper installed, Sentinel calls:

```js
window.glitchreplay.reportQA({
  notes,
  reviewer,
  source: "sentinel",
  evidence,
  extra: {
    pageUrl,
    githubIssueUrl,
    screenshot
  }
});
```

That sends a normal GlitchReplay event through the page's existing SDK session. The active replay is linked by GlitchReplay.

If the helper is not installed, Sentinel silently falls back to GitHub-only reporting.

Customer sites can enable the helper with `@glitchreplay/qa-report`:

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
      blockAllMedia: true
    }),
    qaReportIntegration()
  ]
});
```

More detail: [docs/glitchreplay.md](docs/glitchreplay.md)

## Data Files

Sentinel writes local QA state under:

- `data/profile.json`
- `data/brands/<brand>/projects/<project>/progress.json`
- `data/brands/<brand>/projects/<project>/discovered-urls.json`
- `data/brands/<brand>/projects/<project>/recordings/*.json`
- `screenshots/<brand>/<project>/*.png`

These files are intended to be committed and synced by the app.

## Troubleshooting

### GitHub auth required

Run:

```bash
gh auth login
```

### Issues fail with `Configure githubRepo`

Edit `config/projects.json` and replace `owner/repo` with a real GitHub repo where you can create issues.

### Screenshots do not render in GitHub issues

Run **Sync now** so the screenshot is committed and pushed. The GitHub issue body references the screenshot path in the repo.

### App discovers too many duplicate URLs

Adjust `queryStringMode`:

- `strip-tracking`
- `strip-all`
- `preserve-all`
- `allowlist`

### GlitchReplay does not receive reports

Confirm the reviewed page has `@glitchreplay/qa-report` installed and exposes:

```js
window.glitchreplay.reportQA
```

GitHub issue creation still works without GlitchReplay.

## Current Limitations

- No signed macOS/Windows/Linux installers yet.
- GitHub issue creation depends on system `gh`.
- Screenshot handling is repo-link based rather than true GitHub issue binary upload.
- Replay automation is not implemented yet; action recording is stored for a future Playwright replay mode.
- GlitchReplay integration requires the reviewed site to install `@glitchreplay/qa-report`.

## License

MIT. See [LICENSE](LICENSE).
