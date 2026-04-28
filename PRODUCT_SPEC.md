# Sitemap Sentinel Product Specification

## 1. Product Summary

Sitemap Sentinel is an open-source desktop QA application for reviewing all pages across many websites quickly and consistently. It uses sitemaps and internal link discovery to build the page queue, lets a QA reviewer approve pages or file issues, captures screenshots and technical evidence automatically, and syncs QA progress through Git.

The product is designed for teams that still need human visual QA but want to remove the repetitive administrative work: opening URLs, tracking progress, taking screenshots, copying console errors, creating GitHub issues, and knowing which pages need re-review after developers ship fixes.

The first target implementation is an Electron app. Electron is preferred because it can load real pages in a Chromium webview, capture screenshots directly, preserve login sessions, observe console and network events, and use local Git/GitHub CLI workflows without requiring a hosted backend.

## 2. Primary Users

### QA Reviewer

Reviews pages, approves working pages, adds notes when a problem is found, and relies on the tool to route useful issue reports with evidence attached.

### Developer

Receives structured issue reports containing the affected URL, screenshot, reviewer notes, console errors, failed network requests, browser metadata, and optional reproduction steps.

### Repository Maintainer

Forks or configures the tool for their organization, defines project mappings, manages branch strategy, and ensures QA state syncs through Git.

## 3. Core Goals

1. Let a QA reviewer work through every relevant page of one or more sites without leaving the app.
2. Automatically create high-quality issue reports from reviewer notes, defaulting to GitHub Issues.
3. Capture enough technical evidence that developers can fix issues without repeated follow-up.
4. Track page review status across sessions and across multiple QA reviewers.
5. Re-review only pages that are new, unresolved, or modified since the last QA pass.
6. Support sites with sitemaps and sites without sitemaps.
7. Build a foundation for future replay-based automated regression testing.

## 4. Non-Goals for MVP

1. Hosted SaaS deployment.
2. Multi-tenant cloud database.
3. Replacing full Playwright, Cypress, or unit test suites.
4. Perfect self-healing automation in the first release.
5. Deep accessibility, SEO, or performance auditing beyond captured page metadata.
6. Running untrusted third-party websites without user consent or security warnings.

## 5. Technical Stack

### Desktop Runtime

Electron with a main process, renderer process, preload scripts, and Chromium webviews.

### UI

React with TypeScript is recommended for the renderer. Styling can use Tailwind CSS or a small component system, but the interface should remain practical and dense rather than marketing-oriented.

### Data Storage

Local JSON files committed to the same Git repository as the QA tool or to a dedicated QA data repository.

### GitHub Integration

Use GitHub CLI (`gh`) for authentication and issue creation in MVP. The app should prefer the system-installed `gh` first, then fall back to a bundled binary if one is available and configured.

### Git Sync

Use local `git` commands from the Electron main process. QA progress is saved locally immediately and synced in batches.

### Sitemap Parsing

Use a robust XML parser such as `fast-xml-parser`. The parser must support sitemap indexes and nested sitemap files.

### Automation Foundation

Use Playwright later for replaying recorded actions. MVP should support passive action recording as a configurable feature and store actions in a Playwright-compatible structure, even if automated replay is not fully implemented.

## 6. Product Modes

### Sitemap Mode

Used when a project has one or more sitemap URLs.

The app fetches sitemap XML, recursively follows sitemap indexes, extracts URLs and `lastmod` values, then compares sitemap data against local QA progress.

### Discover Mode

Used when a project has no sitemap or when additional routes exist outside the sitemap.

The app starts from one or more seed URLs. On every loaded page, the preload scraper collects all internal hyperlinks visible in the DOM and adds unknown URLs to the pending review list.

### Hybrid Mode

Used when a project has a sitemap but the reviewer also wants the app to discover missing pages. The sitemap provides the initial list, and link scraping adds newly found URLs.

### Replay Mode

Future mode. The app replays previously recorded interactions for approved pages and reports failures, visual diffs, console errors, and network failures.

## 7. Configuration

Configuration lives in `config/projects.json`. The app should ship with `config/projects.example.json`.

Projects are grouped by brand because a real product may have multiple domains or subdomains, such as `superpowerresume.com` and `app.superpowerresume.com`.

```json
{
  "schemaVersion": 1,
  "sync": {
    "enabled": true,
    "batchPageCount": 10,
    "inactivitySeconds": 600,
    "branchStrategy": "per-user",
    "branchPrefix": "qa",
    "allowSameBranchCollaboration": false
  },
  "github": {
    "cliPreference": "system-first",
    "bundledGhFallback": true
  },
  "screenshots": {
    "storage": "repo",
    "commitScreenshots": true,
    "deleteAfterIssueCreation": false
  },
  "discovery": {
    "queryStringMode": "strip-tracking",
    "trackingParams": ["utm_*", "fbclid", "gclid", "msclkid"]
  },
  "brands": [
    {
      "id": "superpower-resume",
      "name": "Superpower Resume",
      "projects": [
        {
          "id": "spr-marketing",
          "name": "Marketing Site",
          "rootUrl": "https://superpowerresume.com",
          "sitemaps": ["https://superpowerresume.com/sitemap.xml"],
          "mode": "hybrid",
          "githubRepo": "org/superpower-marketing",
          "labels": ["qa", "website"],
          "webviewPartition": "persist:superpower-resume"
        },
        {
          "id": "spr-app",
          "name": "User App",
          "rootUrl": "https://app.superpowerresume.com",
          "sitemaps": [],
          "mode": "discover",
          "seedUrls": [
            "https://app.superpowerresume.com/dashboard",
            "https://app.superpowerresume.com/settings"
          ],
          "githubRepo": "org/superpower-app",
          "labels": ["qa", "app"],
          "webviewPartition": "persist:superpower-resume"
        }
      ]
    }
  ]
}
```

### Required Project Fields

- `id`: Stable machine-readable identifier.
- `name`: Human-readable project name.
- `rootUrl`: Canonical root URL for URL matching.
- `githubRepo`: GitHub repo in `owner/repo` format.
- `mode`: `sitemap`, `discover`, or `hybrid`.

### Optional Project Fields

- `sitemaps`: List of sitemap URLs.
- `seedUrls`: Initial URLs for discover mode.
- `labels`: Labels applied to created GitHub issues.
- `webviewPartition`: Electron session partition for persistent login state.
- `ignorePatterns`: URL patterns to exclude, such as `/logout`, `mailto:`, `tel:`, query-heavy URLs, or admin-only paths.
- `includeSubdomains`: Whether subdomains under the root domain should be considered internal.
- `allowedDomains`: Explicit domains that belong to the project or brand.
- `queryStringMode`: Project-level override for discovery URL query handling. Supported values: `strip-all`, `strip-tracking`, `preserve-all`, `allowlist`.
- `allowedQueryParams`: Query params to preserve when `queryStringMode` is `allowlist`.
- `recordActions`: Project-level override for passive action recording.

## 8. File Structure

Recommended repository structure:

```text
sitemap-sentinel/
├── config/
│   ├── projects.example.json
│   └── projects.json
├── data/
│   └── brands/
│       └── superpower-resume/
│           └── projects/
│               ├── spr-marketing/
│               │   ├── progress.json
│               │   ├── discovered-urls.json
│               │   ├── issues.json
│               │   └── recordings/
│               └── spr-app/
│                   ├── progress.json
│                   ├── discovered-urls.json
│                   ├── issues.json
│                   └── recordings/
├── screenshots/
│   └── superpower-resume/
├── src/
│   ├── main/
│   │   ├── app.ts
│   │   ├── github-cli.ts
│   │   ├── git-sync.ts
│   │   ├── sitemap.ts
│   │   ├── storage.ts
│   │   └── webview-events.ts
│   ├── preload/
│   │   ├── qa-spy.ts
│   │   └── link-scraper.ts
│   └── renderer/
│       ├── components/
│       ├── state/
│       └── App.tsx
└── package.json
```

## 9. Data Model

### Page Progress

Stored per project in `progress.json`.

```json
{
  "schemaVersion": 1,
  "pages": {
    "https://example.com/pricing": {
      "url": "https://example.com/pricing",
      "normalizedUrl": "https://example.com/pricing",
      "source": "sitemap",
      "sitemapLastmod": "2026-04-21T18:12:00.000Z",
      "status": "approved",
      "lastInspectedAt": "2026-04-28T15:01:22.000Z",
      "lastInspectedBy": "sean",
      "lastIssueNumber": null,
      "lastIssueUrl": null,
      "reviewCount": 3,
      "recordingPath": "recordings/pricing.json",
      "lastScreenshotPath": "screenshots/superpower-resume/spr-marketing/pricing-2026-04-28T150122.png",
      "tags": []
    }
  }
}
```

### Page Status Values

- `pending`: Known page, not yet reviewed.
- `approved`: QA reviewer approved the page.
- `issue`: QA reviewer created an issue.
- `needs_recheck`: Page was previously reviewed but sitemap `lastmod` is newer than `lastInspectedAt`.
- `discovered`: Found through link scraping but not yet visited by the reviewer.
- `skipped`: Reviewer intentionally skipped the page.
- `ignored`: Page should not appear in normal review queues.

### Discovered URLs

Stored per project in `discovered-urls.json`.

```json
{
  "schemaVersion": 1,
  "urls": {
    "https://app.example.com/settings": {
      "url": "https://app.example.com/settings",
      "normalizedUrl": "https://app.example.com/settings",
      "firstDiscoveredAt": "2026-04-28T15:04:00.000Z",
      "firstDiscoveredFrom": "https://app.example.com/dashboard",
      "lastSeenAt": "2026-04-28T15:10:00.000Z",
      "seenCount": 4,
      "status": "discovered"
    }
  }
}
```

### Recording

Stored as one JSON file per page in `recordings/`.

```json
{
  "schemaVersion": 1,
  "pageUrl": "https://app.example.com/dashboard",
  "createdAt": "2026-04-28T15:04:00.000Z",
  "updatedAt": "2026-04-28T15:06:00.000Z",
  "viewport": {
    "width": 1440,
    "height": 900,
    "deviceScaleFactor": 2
  },
  "steps": [
    {
      "type": "click",
      "timestamp": "2026-04-28T15:04:12.000Z",
      "selectorBundle": {
        "css": "button[data-testid='new-resume']",
        "text": "New resume",
        "role": "button",
        "ariaLabel": "New resume",
        "xpath": "/html/body/div/main/button[1]"
      }
    },
    {
      "type": "input",
      "timestamp": "2026-04-28T15:04:18.000Z",
      "selectorBundle": {
        "css": "input[name='title']",
        "text": "",
        "role": "textbox",
        "ariaLabel": "Resume title",
        "xpath": "/html/body/div/main/form/input[1]"
      },
      "valueStrategy": "redacted"
    }
  ]
}
```

Sensitive typed values should be redacted by default. The app should not store passwords, tokens, payment data, or personal content unless the user explicitly enables unsafe recording.

## 10. Sitemap Engine

### Fetching

The app fetches configured sitemap URLs when a project is loaded or refreshed.

Requirements:

- Support standard URL sets.
- Support sitemap indexes recursively.
- Preserve `loc` and `lastmod`.
- Tolerate missing `lastmod`.
- Deduplicate URLs after normalization.
- Report malformed sitemap errors clearly.

### URL Normalization

The app should normalize URLs before comparing them.

Rules:

- Remove hash fragments.
- Apply the configured `queryStringMode`.
- `strip-all`: remove all query parameters.
- `strip-tracking`: remove tracking query params such as `utm_*`, `fbclid`, `gclid`, and `msclkid`, while preserving other params.
- `preserve-all`: keep query strings exactly as discovered.
- `allowlist`: preserve only configured `allowedQueryParams`.
- Normalize trailing slash according to project setting.
- Lowercase protocol and hostname.

### Delta Review

The app compares sitemap `lastmod` to local `lastInspectedAt`.

A page needs review when:

- It exists in the sitemap but not in local progress.
- Its status is `pending`, `discovered`, `issue`, or `needs_recheck`.
- Its sitemap `lastmod` is newer than `lastInspectedAt`.

If `lastmod` is missing, the page should not be automatically marked modified after approval, but it should still appear if new or unresolved.

## 11. Discover Mode

Discover mode automatically finds internal URLs from hyperlinks on each loaded page.

### Link Scraping Behavior

The preload script must:

- Scrape all `a[href]` elements after page load.
- Scrape again after DOM mutations.
- Scrape after route changes in single-page applications.
- Send batches of discovered URLs to the main process.

The main process must:

- Normalize discovered URLs.
- Deduplicate against known pages.
- Apply project include and ignore rules.
- Add new URLs with status `discovered`.
- Store discovery source URL and timestamps.

### Internal URL Matching

A URL is internal when:

- Its hostname matches the project root hostname.
- Or its hostname is listed in `allowedDomains`.
- Or it belongs to the same brand and matches another configured project.

If a link belongs to another configured project, the app should add it to that project instead of the current project.

### Discover Mode Sidebar

The sidebar should show:

- Current queue.
- Newly discovered pending URLs.
- Reviewed URLs.
- Ignored URLs only when an advanced filter is active.

## 12. Webview and Session Handling

Each project loads pages in an Electron webview or equivalent BrowserView.

Requirements:

- Persistent session partitions so QA users can log into app subdomains once.
- Separate partitions when projects should not share cookies.
- Loading indicator for page transitions.
- Error state for navigation failures.
- Back, forward, reload, and open-in-external-browser controls.
- Viewport size controls for common QA breakpoints.

Recommended viewport presets:

- Desktop: 1440 x 900.
- Laptop: 1280 x 800.
- Tablet: 768 x 1024.
- Mobile: 390 x 844.

## 13. Evidence Capture

When a reviewer creates an issue, the app must capture technical and visual evidence automatically.

### Screenshot

Capture the current webview viewport as PNG using Electron screenshot APIs.

MVP captures viewport screenshots. Full-page screenshots can be added later through Playwright.

### Console Errors

Capture:

- `console.error`.
- `window.onerror`.
- unhandled promise rejections.
- Optionally `console.warn`.

Console entries should include:

- Timestamp.
- Level.
- Message.
- Source file if available.
- Line and column if available.
- Current URL.

### Network Failures

Capture failed or suspicious requests:

- HTTP 400-599.
- DNS or connection failures.
- Blocked or aborted requests when meaningful.

Entries should include:

- Timestamp.
- Method.
- URL.
- Status code.
- Resource type if available.
- Referrer or page URL.

### Browser Metadata

Capture:

- Page URL.
- Project ID.
- Brand ID.
- Timestamp.
- Viewport width and height.
- Device scale factor.
- User agent.
- App version.
- Platform.

### Interaction Recording

If `autoRecord` is enabled, capture reviewer interactions during a page session:

- Clicks.
- Text inputs, with value redaction by default.
- Select changes.
- Form submits.
- Route changes.

Each event should store a selector bundle rather than a single fragile selector.

## 14. QA Workflow

### Normal Review Flow

1. User opens the app.
2. App checks `gh auth status`.
3. App pulls the latest Git data if sync is enabled.
4. User selects a brand and project.
5. App fetches sitemap or initializes discover mode.
6. App displays the Needs Review queue.
7. User selects a page.
8. Page loads in the webview.
9. App captures console, network, discovered links, and optional actions.
10. User clicks Approve, Report Issue, Skip, or Ignore.
11. App saves progress locally immediately.
12. App advances to the next page unless the user disables auto-advance.
13. App syncs in the background based on configured triggers.

### Approve

When approved:

- Set status to `approved`.
- Set `lastInspectedAt` to now.
- Set `lastInspectedBy`.
- Save current sitemap `lastmod`.
- Save recording if enabled.
- Increment review count.
- Advance to next page.

### Report Issue

When an issue is reported:

- Require non-empty notes unless technical errors were captured and the user confirms.
- Capture screenshot.
- Build GitHub issue title and body.
- Attach the screenshot to the GitHub issue when supported.
- Create a GitHub issue through `gh issue create`.
- Store returned GitHub issue URL and issue number if available.
- Set status to `issue`.
- Set `lastInspectedAt`.
- Save recording.
- Advance to next page after the GitHub issue is created.

### Skip

When skipped:

- Set status to `skipped`.
- Require optional reason.
- Do not create GitHub issue.
- Keep page visible under skipped filter.

### Ignore

When ignored:

- Set status to `ignored`.
- Require reason.
- Hide from normal queues.

## 15. GitHub Issue Creation

GitHub issue creation is the MVP reporting path. Clicking Report Issue should create a GitHub issue through `gh` in the project's configured `githubRepo`.

### Command

MVP uses GitHub CLI. The app resolves the CLI path in this order:

1. System-installed `gh` found on `PATH`.
2. Bundled `gh` binary if `github.bundledGhFallback` is enabled.
3. User-configured custom `gh` path, if added in a future settings screen.

The default behavior is system-first because many users already authenticate and manage GitHub accounts through their local CLI.

```bash
gh issue create \
  --repo owner/repo \
  --title "[QA] Problem on /path" \
  --body-file /path/to/generated-body.md \
  --label qa \
  --label website
```

If screenshot attachment through `gh` is not reliable for the installed CLI version, the app should either:

- Use GitHub CLI/API support for uploading attachments when available.
- Or store screenshots in the QA repo and link to the committed file in the GitHub issue body.
- Or fall back to a clear local screenshot path in the issue body with a warning that the screenshot was not attached.

### Issue Body Template

```md
## QA Notes

{reviewer_notes}

## Page

- URL: {page_url}
- Project: {project_name}
- Reviewed by: {reviewer}
- Reviewed at: {timestamp}

## Screenshot

{screenshot_reference}

## Browser Metadata

- Viewport: {width} x {height}
- Device scale factor: {device_scale_factor}
- User agent: {user_agent}
- Platform: {platform}

## Console Errors

{console_errors_or_none}

## Network Failures

{network_failures_or_none}

## Recorded Steps

{recorded_steps_summary_or_none}
```

### Title Strategy

Default:

```text
[QA] {projectName}: {pathname}
```

If console or network failures are present, the app may suggest a more specific title, but the reviewer should be able to edit it before submission.

## 16. Future Integrations

GlitchReplay integration is intentionally out of MVP scope. The first version should focus on reliable GitHub issue creation with screenshot evidence. A later release may add GlitchReplay by configuring a project DSN and sending Sentry SDK events from the Electron main process.

## 17. Git Sync

The app saves all progress locally immediately. Git sync runs in the background.

### Sync Triggers

Sync should run when any of the following occur:

- 10 pages have been processed since the last successful sync.
- 600 seconds of inactivity pass with unsynced changes.
- The app is closing.
- User clicks Sync Now.

Both page count and inactivity threshold must be configurable.

### Sync Algorithm

Recommended MVP sync:

1. Ensure the reviewer is on the configured QA branch.
2. Check if there are local changes.
3. Stage known data paths only.
4. Commit with a generated message.
5. Pull with rebase from the matching remote branch.
6. Push the current branch.
7. Update sync status in UI.

Default branch behavior is `per-user`. On first run, the app should derive a branch name from the GitHub username, such as `qa/sean`, create it if missing, and push to that branch. This reduces conflicts between reviewers. The behavior must remain configurable so maintainers can choose `current-branch`, `per-user`, or `per-project`.

Recommended command sequence:

```bash
git add config data screenshots
git commit -m "QA sync: {count} pages processed [skip ci]"
git pull --rebase origin {branch}
git push origin {branch}
```

### Important Constraint

The app must not run `git add .` by default because the repository may contain unrelated local files.

### Conflict Handling

If rebase conflicts occur:

- Pause background sync.
- Keep local QA work saved.
- Show a blocking sync error in the UI.
- Provide a copyable diagnostic message.
- Let the user or maintainer resolve the conflict manually.

Future versions may implement JSON-aware merge resolution for progress files.

### Sync Status UI

The app should display:

- Synced.
- Unsynced changes count.
- Syncing.
- Sync failed.
- Auth required.
- Conflict requires manual resolution.

## 18. Authentication and Startup Checks

On startup, the app should check:

- `gh` is available.
- `gh auth status` succeeds.
- `git` is available.
- Current directory is a Git repository when sync is enabled.
- Config file exists and is valid.
- Data directories are writable.

If GitHub auth is missing:

- Show an Authentication Required screen.
- Provide a button to run `gh auth login --web`.
- Poll auth status after login starts.

If `gh` is missing:

- Show installation guidance.
- If packaged with bundled binaries, use the bundled binary.

## 19. User Interface

### Layout

The app uses a three-zone workbench:

- Left sidebar: brand/project selector, filters, URL queue, progress.
- Main panel: loaded website.
- Bottom or right inspector: notes, captured evidence, actions.

### Sidebar

Required controls:

- Brand selector.
- Project selector.
- Search URLs.
- Filter tabs.
- Sort menu.
- Progress counts.

Required filters:

- Needs Review.
- New.
- Updated.
- Discovered.
- Issues.
- Approved.
- Skipped.
- Ignored.
- All.

### Page Row Indicators

Each URL row should show:

- Status badge.
- Source badge: sitemap, discovered, seed, manual.
- Modified indicator if sitemap `lastmod` is newer than `lastInspectedAt`.
- Issue indicator if an issue exists.
- Optional count of console or network errors from the last review.

### Main Webview Toolbar

Required controls:

- Back.
- Forward.
- Reload.
- Open externally.
- Viewport preset.
- Current URL display.
- Loading state.

### Inspector

Required controls:

- Notes field.
- Approve button.
- Report Issue button.
- Skip button.
- Ignore button.
- Console errors preview.
- Network failures preview.
- Recording preview.
- Screenshot preview after capture.

### Keyboard Shortcuts

- `Cmd/Ctrl + Enter`: Approve and advance.
- `Cmd/Ctrl + Shift + Enter`: Create issue from current notes.
- `Cmd/Ctrl + F`: Focus URL search.
- `Cmd/Ctrl + R`: Reload page.
- `Cmd/Ctrl + S`: Sync now.
- `Esc`: Close modal or blur current input.

## 20. URL Discovery and Cross-Project Routing

The app must support products with multiple related domains and subdomains.

Example:

- `https://superpowerresume.com`
- `https://app.superpowerresume.com`

If a discovered link belongs to another configured project:

1. Add the URL to that target project's discovered list.
2. Show a subtle indicator that a cross-project URL was found.
3. Do not create issues in the wrong GitHub repo.

When the reviewer navigates manually to a URL that matches another project, the app should prompt to switch active project or automatically switch if configured.

## 21. Action Recording and Future Replay

MVP should record actions passively so the team can build automation later without changing the data model.

### Selector Bundle

For every interacted element, capture:

- Stable CSS selector if available.
- `data-testid`, `data-qa`, or similar attributes.
- Role.
- Accessible name.
- Text snippet.
- Element tag.
- Element name.
- XPath fallback.

### Replay Strategy

Future replay should try selectors in this order:

1. Stable test attribute.
2. Role plus accessible name.
3. ID.
4. Name.
5. Text.
6. CSS path.
7. XPath.

If a replay step fails:

- Pause.
- Show the failed step.
- Let the user perform the correct action manually.
- Update that step's selector bundle.
- Continue replay.

## 22. Security and Privacy

### Sensitive Data

The app must avoid storing sensitive values by default.

Do not record:

- Passwords.
- Tokens.
- Credit card fields.
- Hidden inputs.
- Fields marked with configured sensitive selectors.

Input events should store that input happened, not the value, unless explicitly configured.

### Local Files

Screenshots may contain sensitive information. The MVP should add screenshots to the created GitHub issue whenever possible. Screenshots are also stored locally under `screenshots/` so they can be retried or linked if attachment fails.

Provide config options:

- Attach screenshots to GitHub issues. This is the default.
- Store screenshots in the repo and commit them as a fallback.
- Store screenshots locally but do not commit them.
- Delete screenshots after issue creation.

### Command Execution

All Git and GitHub commands must be constructed using argument arrays, not unsanitized shell string interpolation.

## 23. Error Handling

The app should handle:

- Sitemap fetch failure.
- Malformed XML.
- Page navigation failure.
- Authentication failure.
- GitHub issue creation failure.
- Screenshot capture failure.
- Git sync failure.
- Rebase conflict.
- Missing config.
- Invalid repo mapping.

Every failure should preserve local QA progress and show a clear recovery path.

## 24. Packaging and Open Source Distribution

The project should be forkable and runnable locally.

### Minimum Setup

```bash
npm install
npm run dev
cp config/projects.example.json config/projects.json
gh auth login
```

### Documentation Must Explain

- How to add projects.
- How sitemap mode works.
- How discover mode works.
- How GitHub issue creation works.
- How screenshots are added to GitHub issues.
- How auto-sync works.
- How to handle app subdomains.
- How to avoid committing sensitive screenshots.
- How to resolve sync conflicts.

### License

Use a permissive license such as MIT unless there is a reason to choose otherwise.

## 25. MVP Scope

### Must Have

1. Electron app shell.
2. Project config loading.
3. Sitemap parsing with sitemap index support.
4. Discover mode link scraping.
5. Sidebar URL queue with filters.
6. Webview page loading.
7. Approve, skip, ignore, and report issue actions.
8. Screenshot capture.
9. Console error capture.
10. Network failure capture.
11. GitHub issue creation through `gh`.
12. Screenshot attachment or screenshot link in created GitHub issues.
13. Local JSON persistence.
14. Git sync every 10 pages, 600 seconds idle, and app close.
15. Delta filter based on sitemap `lastmod`.
16. Persistent webview sessions for logged-in app subdomains.

### Should Have

1. Viewport presets.
2. Search and sorting.
3. Action recording.
4. Cross-project discovered URL routing.
5. Sync status indicator.
6. Manual URL add and bulk paste.
7. Config validation with friendly errors.

### Could Have

1. Playwright replay.
2. Visual diffing.
3. Export discovered URLs to CSV or sitemap XML.
4. JSON-aware conflict resolver.
5. GitHub issue status polling.
6. Automatic recheck queue when GitHub issues close.

## 26. Implementation Roadmap

### Phase 1: App Foundation

- Scaffold Electron, React, and TypeScript.
- Load config.
- Render brand/project selector.
- Load a hardcoded URL in webview.
- Implement persistent sessions.

### Phase 2: Sitemap and Discovery

- Parse sitemap XML and sitemap indexes.
- Build normalized URL list.
- Implement discover mode scraper.
- Store progress and discovered URLs.
- Render sidebar queues and filters.

### Phase 3: Review Workflow

- Implement approve, skip, ignore.
- Add notes panel.
- Auto-advance after actions.
- Add keyboard shortcuts.
- Add viewport presets.

### Phase 4: Evidence Capture

- Capture screenshots.
- Capture console errors.
- Capture unhandled promise rejections.
- Capture failed network requests.
- Build issue body preview.

### Phase 5: GitHub Issues

- Check `gh` availability and auth.
- Create GitHub issues.
- Attach screenshots to GitHub issues or include a committed screenshot link fallback.
- Store issue metadata.
- Handle issue creation errors.

### Phase 6: Git Sync

- Save changes locally immediately.
- Track unsynced page count.
- Sync every 10 processed pages.
- Sync after 600 seconds inactivity.
- Sync on app close.
- Show sync state and failures.

### Phase 7: Automation Foundation

- Record interactions with selector bundles.
- Save recordings per page.
- Add recording preview.
- Prepare Playwright-compatible replay format.

## 27. Acceptance Criteria

The MVP is successful when:

1. A reviewer can configure at least two projects under one brand, including one root domain and one app subdomain.
2. The app can load URLs from a sitemap and recursively parse sitemap indexes.
3. The app can run without a sitemap and discover internal URLs from hyperlinks on loaded pages.
4. The reviewer can approve a page and see it removed from Needs Review.
5. The reviewer can report an issue with notes, screenshot, console errors, network failures, and metadata.
6. Report Issue creates a GitHub issue through `gh`.
7. The created GitHub issue includes screenshot evidence as an attachment or link.
8. The app maps each URL to the correct GitHub repository.
9. The app persists progress after restart.
10. The app flags pages as Updated when sitemap `lastmod` is newer than the last inspection timestamp.
11. The app syncs QA data through Git after 10 processed pages, after 600 seconds idle, and on exit.
12. The app never loses local progress when GitHub or Git sync fails.

## 28. Key Product Principles

1. Human-first QA: the reviewer stays in control.
2. Evidence by default: every issue should be useful to a developer immediately.
3. Local-first storage: progress must survive crashes and offline work.
4. Git-backed collaboration: no database required for small teams.
5. Differential review: only show pages that need attention.
6. Forkable architecture: users can adapt the tool to their own websites and repos.
7. Automation-ready data: manual QA should create reusable regression assets over time.
