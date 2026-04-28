import { app, BrowserWindow, ipcMain, shell, webContents } from "electron";
import { XMLParser } from "fast-xml-parser";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

const CONFIG_PATH = path.join(repoRoot, "config/projects.json");
const EXAMPLE_CONFIG_PATH = path.join(repoRoot, "config/projects.example.json");
const DATA_ROOT = path.join(repoRoot, "data/brands");
const SCREENSHOT_ROOT = path.join(repoRoot, "screenshots");

let mainWindow = null;
let pendingPageCount = 0;
let syncTimer = null;

function shouldUseDevServer() {
  return process.env.npm_lifecycle_event === "dev";
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function ensureConfig() {
  await ensureDir(path.dirname(CONFIG_PATH));
  if (!existsSync(CONFIG_PATH)) {
    await fs.copyFile(EXAMPLE_CONFIG_PATH, CONFIG_PATH);
  }
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

function dataDir(brandId, projectId) {
  return path.join(DATA_ROOT, slug(brandId), "projects", slug(projectId));
}

function progressPath(brandId, projectId) {
  return path.join(dataDir(brandId, projectId), "progress.json");
}

function discoveredPath(brandId, projectId) {
  return path.join(dataDir(brandId, projectId), "discovered-urls.json");
}

function recordingPath(brandId, projectId, pageUrl) {
  const url = new URL(pageUrl);
  const name = slug(`${url.hostname}-${url.pathname || "home"}-${url.search || ""}`) || "home";
  return path.join(dataDir(brandId, projectId), "recordings", `${name}.json`);
}

function screenshotPath(brandId, projectId, pageUrl) {
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const url = new URL(pageUrl);
  const name = slug(`${url.hostname}-${url.pathname || "home"}-${now}`) || `screenshot-${now}`;
  return path.join(SCREENSHOT_ROOT, slug(brandId), slug(projectId), `${name}.png`);
}

async function loadConfig() {
  await ensureConfig();
  return readJson(CONFIG_PATH, null);
}

function findProject(config, brandId, projectId) {
  const brand = config.brands.find((candidate) => candidate.id === brandId);
  if (!brand) throw new Error(`Unknown brand: ${brandId}`);
  const project = brand.projects.find((candidate) => candidate.id === projectId);
  if (!project) throw new Error(`Unknown project: ${projectId}`);
  return { brand, project };
}

function wildcardMatch(pattern, value) {
  if (pattern.endsWith("*")) return value.startsWith(pattern.slice(0, -1));
  return value === pattern;
}

function normalizeUrl(rawUrl, config, project) {
  const url = new URL(rawUrl, project.rootUrl);
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  const mode = project.queryStringMode || config.discovery?.queryStringMode || "strip-tracking";
  if (mode === "strip-all") {
    url.search = "";
  } else if (mode === "strip-tracking") {
    const tracking = config.discovery?.trackingParams || ["utm_*", "fbclid", "gclid", "msclkid"];
    for (const key of Array.from(url.searchParams.keys())) {
      if (tracking.some((pattern) => wildcardMatch(pattern, key))) {
        url.searchParams.delete(key);
      }
    }
  } else if (mode === "allowlist") {
    const allowed = new Set(project.allowedQueryParams || []);
    for (const key of Array.from(url.searchParams.keys())) {
      if (!allowed.has(key)) url.searchParams.delete(key);
    }
  }

  return url.href;
}

function belongsToProject(rawUrl, project) {
  try {
    const url = new URL(rawUrl);
    const root = new URL(project.rootUrl);
    const allowed = new Set([root.hostname, ...(project.allowedDomains || [])]);
    if (allowed.has(url.hostname)) return true;
    return Boolean(project.includeSubdomains && url.hostname.endsWith(`.${root.hostname}`));
  } catch {
    return false;
  }
}

function shouldIgnore(rawUrl, project) {
  const ignorePatterns = project.ignorePatterns || [];
  return ignorePatterns.some((pattern) => rawUrl.includes(pattern));
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchSitemapUrls(sitemapUrl, seen = new Set()) {
  if (seen.has(sitemapUrl)) return [];
  seen.add(sitemapUrl);

  const response = await fetch(sitemapUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sitemapUrl}: ${response.status}`);
  }

  const xml = await response.text();
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const parsed = parser.parse(xml);

  if (parsed.sitemapindex?.sitemap) {
    const nested = asArray(parsed.sitemapindex.sitemap);
    const results = [];
    for (const item of nested) {
      if (item.loc) {
        results.push(...(await fetchSitemapUrls(item.loc, seen)));
      }
    }
    return results;
  }

  const entries = asArray(parsed.urlset?.url);
  return entries
    .filter((item) => item.loc)
    .map((item) => ({
      url: item.loc,
      sitemapLastmod: item.lastmod ? new Date(item.lastmod).toISOString() : null,
      source: "sitemap"
    }));
}

async function loadProjectState(config, brandId, projectId) {
  const { brand, project } = findProject(config, brandId, projectId);
  const progress = await readJson(progressPath(brand.id, project.id), { schemaVersion: 1, pages: {} });
  const discovered = await readJson(discoveredPath(brand.id, project.id), { schemaVersion: 1, urls: {} });
  const warnings = [];
  const sitemapPages = [];

  if ((project.mode === "sitemap" || project.mode === "hybrid") && project.sitemaps?.length) {
    for (const sitemap of project.sitemaps) {
      try {
        sitemapPages.push(...(await fetchSitemapUrls(sitemap)));
      } catch (error) {
        warnings.push(error.message);
      }
    }
  }

  for (const seedUrl of project.seedUrls || []) {
    sitemapPages.push({ url: seedUrl, sitemapLastmod: null, source: "seed" });
  }

  const known = new Map();
  for (const page of sitemapPages) {
    try {
      const normalizedUrl = normalizeUrl(page.url, config, project);
      if (!belongsToProject(normalizedUrl, project) || shouldIgnore(normalizedUrl, project)) continue;
      known.set(normalizedUrl, { ...page, url: normalizedUrl, normalizedUrl });
    } catch {
      warnings.push(`Ignored invalid URL from sitemap: ${page.url}`);
    }
  }

  for (const item of Object.values(discovered.urls || {})) {
    if (!known.has(item.normalizedUrl)) {
      known.set(item.normalizedUrl, { ...item, source: item.source || "discovered" });
    }
  }

  for (const item of Object.values(progress.pages || {})) {
    if (!known.has(item.normalizedUrl || item.url)) {
      known.set(item.normalizedUrl || item.url, { ...item, source: item.source || "manual" });
    }
  }

  const pages = Array.from(known.values()).map((page) => {
    const stored = progress.pages[page.normalizedUrl] || {};
    const sitemapLastmod = page.sitemapLastmod || stored.sitemapLastmod || null;
    const lastInspectedAt = stored.lastInspectedAt || null;
    const isModified = Boolean(
      sitemapLastmod &&
        lastInspectedAt &&
        new Date(sitemapLastmod).getTime() > new Date(lastInspectedAt).getTime()
    );
    const status = isModified && stored.status === "approved" ? "needs_recheck" : stored.status || page.status || "pending";

    return {
      ...page,
      ...stored,
      url: page.url,
      normalizedUrl: page.normalizedUrl || page.url,
      sitemapLastmod,
      lastInspectedAt,
      status,
      needsReview: ["pending", "discovered", "issue", "needs_recheck"].includes(status),
      isModified,
      isNew: !stored.status
    };
  });

  pages.sort((a, b) => {
    const priority = { issue: 0, needs_recheck: 1, pending: 2, discovered: 3, approved: 4, skipped: 5, ignored: 6 };
    return (priority[a.status] ?? 9) - (priority[b.status] ?? 9) || a.url.localeCompare(b.url);
  });

  return { brand, project, progress, discovered, pages, warnings };
}

async function savePageStatus(config, payload) {
  const { brand, project } = findProject(config, payload.brandId, payload.projectId);
  const filePath = progressPath(brand.id, project.id);
  const progress = await readJson(filePath, { schemaVersion: 1, pages: {} });
  const normalizedUrl = normalizeUrl(payload.url, config, project);
  const existing = progress.pages[normalizedUrl] || {};
  progress.pages[normalizedUrl] = {
    ...existing,
    url: normalizedUrl,
    normalizedUrl,
    source: existing.source || payload.source || "manual",
    sitemapLastmod: payload.sitemapLastmod || existing.sitemapLastmod || null,
    status: payload.status,
    lastInspectedAt: new Date().toISOString(),
    lastInspectedBy: await currentGitHubUser(),
    lastIssueNumber: payload.issueNumber ?? existing.lastIssueNumber ?? null,
    lastIssueUrl: payload.issueUrl ?? existing.lastIssueUrl ?? null,
    lastScreenshotPath: payload.screenshotPath ?? existing.lastScreenshotPath ?? null,
    reviewCount: (existing.reviewCount || 0) + 1
  };
  await writeJson(filePath, progress);
  pendingPageCount += 1;
  resetInactivityTimer(config);
  return progress.pages[normalizedUrl];
}

async function saveDiscoveredUrls(config, payload) {
  const { brand, project } = findProject(config, payload.brandId, payload.projectId);
  const filePath = discoveredPath(brand.id, project.id);
  const discovered = await readJson(filePath, { schemaVersion: 1, urls: {} });
  const added = [];

  for (const rawUrl of payload.urls || []) {
    try {
      const normalizedUrl = normalizeUrl(rawUrl, config, project);
      if (!belongsToProject(normalizedUrl, project) || shouldIgnore(normalizedUrl, project)) continue;
      const existing = discovered.urls[normalizedUrl];
      discovered.urls[normalizedUrl] = {
        url: normalizedUrl,
        normalizedUrl,
        firstDiscoveredAt: existing?.firstDiscoveredAt || new Date().toISOString(),
        firstDiscoveredFrom: existing?.firstDiscoveredFrom || payload.pageUrl,
        lastSeenAt: new Date().toISOString(),
        seenCount: (existing?.seenCount || 0) + 1,
        status: "discovered",
        source: "discovered"
      };
      if (!existing) added.push(normalizedUrl);
    } catch {
      // Ignore invalid links found in the DOM.
    }
  }

  if (added.length > 0) {
    await writeJson(filePath, discovered);
  }
  return { added };
}

async function saveRecordedAction(config, payload) {
  const { brand, project } = findProject(config, payload.brandId, payload.projectId);
  if (project.recordActions === false) return { saved: false };

  const filePath = recordingPath(brand.id, project.id, payload.pageUrl);
  const recording = await readJson(filePath, {
    schemaVersion: 1,
    pageUrl: payload.pageUrl,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    steps: []
  });

  recording.updatedAt = new Date().toISOString();
  recording.steps.push(payload.action);
  await writeJson(filePath, recording);
  return { saved: true };
}

async function currentGitHubUser() {
  try {
    const result = await execFileAsync("gh", ["api", "user", "--jq", ".login"], { cwd: repoRoot, timeout: 8000 });
    return result.stdout.trim() || "unknown";
  } catch {
    return process.env.USER || process.env.USERNAME || "unknown";
  }
}

async function checkGhAuth() {
  try {
    await execFileAsync("gh", ["auth", "status"], { cwd: repoRoot, timeout: 10000 });
    return { available: true, authenticated: true };
  } catch (error) {
    try {
      await execFileAsync("gh", ["--version"], { cwd: repoRoot, timeout: 5000 });
      return { available: true, authenticated: false, message: error.stderr || error.message };
    } catch {
      return { available: false, authenticated: false, message: "GitHub CLI not found on PATH." };
    }
  }
}

async function captureScreenshot(brandId, projectId, pageUrl, webContentsId) {
  const target = webContents.fromId(Number(webContentsId));
  if (!target) throw new Error("Unable to locate active webview for screenshot capture.");
  const image = await target.capturePage();
  const filePath = screenshotPath(brandId, projectId, pageUrl);
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, image.toPNG());
  return filePath;
}

async function git(args, options = {}) {
  return execFileAsync("git", args, { cwd: repoRoot, timeout: options.timeout || 30000 });
}

async function currentBranch() {
  try {
    const result = await git(["branch", "--show-current"]);
    return result.stdout.trim() || "main";
  } catch {
    return "main";
  }
}

async function localBranchExists(branch) {
  try {
    await git(["rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function targetSyncBranch(config) {
  const strategy = config.sync?.branchStrategy || "current-branch";
  if (strategy === "per-user") {
    const prefix = config.sync?.branchPrefix || "qa";
    const user = await currentGitHubUser();
    return `${prefix}/${slug(user)}`;
  }
  if (strategy === "per-project") {
    return `${config.sync?.branchPrefix || "qa"}/project`;
  }
  return currentBranch();
}

async function ensureSyncBranch(config) {
  const target = await targetSyncBranch(config);
  const current = await currentBranch();
  if (current === target) return target;

  const dirty = (await git(["status", "--short"])).stdout.trim();
  let stashed = false;
  if (dirty) {
    await git(["stash", "push", "--include-untracked", "-m", "sitemap-sentinel-branch-switch"], { timeout: 60000 });
    stashed = true;
  }

  try {
    if (await localBranchExists(target)) {
      await git(["checkout", target]);
    } else {
      await git(["checkout", "-b", target]);
    }
    if (stashed) {
      await git(["stash", "pop"], { timeout: 60000 });
    }
    return target;
  } catch (error) {
    if (stashed) {
      try {
        await git(["stash", "pop"], { timeout: 60000 });
      } catch {
        // Preserve the original branch-switch error; user can recover the stash manually.
      }
    }
    throw error;
  }
}

function githubRawUrl(remote, branch, relativePath) {
  if (!remote) return null;
  let match = remote.match(/github\.com[:/](.+?)\/(.+?)(?:\.git)?$/);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2].replace(/\.git$/, "");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${relativePath
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/")}`;
}

async function screenshotReference(filePath) {
  const relative = path.relative(repoRoot, filePath);
  try {
    const remote = (await git(["config", "--get", "remote.origin.url"])).stdout.trim();
    const branch = await currentBranch();
    return githubRawUrl(remote, branch, relative) || relative;
  } catch {
    return relative;
  }
}

function markdownList(items, formatter) {
  if (!items || items.length === 0) return "_None captured._";
  return items.map(formatter).join("\n");
}

function buildIssueBody({ notes, pageUrl, brand, project, screenshotRef, evidence }) {
  const consoleErrors = evidence?.consoleErrors || [];
  const networkFailures = evidence?.networkFailures || [];
  const metadata = evidence?.metadata || {};
  const recordedSteps = evidence?.recordedSteps || [];

  return `## QA Notes

${notes}

## Page

- URL: ${pageUrl}
- Brand: ${brand.name}
- Project: ${project.name}
- Reviewed at: ${new Date().toISOString()}

## Screenshot

${screenshotRef ? `![Screenshot](${screenshotRef})\n\n${screenshotRef}` : "_Screenshot capture failed or unavailable._"}

## Browser Metadata

- Viewport: ${metadata.viewport || "unknown"}
- Device scale factor: ${metadata.deviceScaleFactor || "unknown"}
- User agent: ${metadata.userAgent || "unknown"}
- Platform: ${process.platform}

## Console Errors

${markdownList(consoleErrors, (entry) => `- \`${entry.level || "error"}\` ${entry.message || entry}`)}

## Network Failures

${markdownList(networkFailures, (entry) => `- ${entry.method || "GET"} ${entry.url || ""} ${entry.status || entry.error || ""}`)}

## Recorded Steps

${markdownList(recordedSteps.slice(-20), (entry) => `- ${entry.type} ${entry.selectorBundle?.css || entry.selectorBundle?.text || entry.selectorBundle?.tagName || ""}`)}
`;
}

function issueTitle(project, pageUrl) {
  const url = new URL(pageUrl);
  const pathName = url.pathname === "/" ? "/" : url.pathname.replace(/\/$/, "");
  return `[QA] ${project.name}: ${pathName || url.hostname}`;
}

async function createGitHubIssue(config, payload) {
  const { brand, project } = findProject(config, payload.brandId, payload.projectId);
  if (!project.githubRepo || project.githubRepo === "owner/repo") {
    throw new Error(`Configure githubRepo for ${project.name} before creating issues.`);
  }
  await ensureSyncBranch(config);

  let screenshotFile = null;
  let screenshotRef = null;
  if (payload.webContentsId) {
    screenshotFile = await captureScreenshot(brand.id, project.id, payload.pageUrl, payload.webContentsId);
    screenshotRef = await screenshotReference(screenshotFile);
  }

  const body = buildIssueBody({
    notes: payload.notes,
    pageUrl: payload.pageUrl,
    brand,
    project,
    screenshotRef,
    evidence: payload.evidence || {}
  });
  const bodyPath = path.join(dataDir(brand.id, project.id), "last-issue-body.md");
  await ensureDir(path.dirname(bodyPath));
  await fs.writeFile(bodyPath, body, "utf8");

  const args = [
    "issue",
    "create",
    "--repo",
    project.githubRepo,
    "--title",
    issueTitle(project, payload.pageUrl),
    "--body-file",
    bodyPath
  ];
  for (const label of project.labels || []) {
    args.push("--label", label);
  }

  const result = await execFileAsync("gh", args, { cwd: repoRoot, timeout: 60000 });
  const issueUrl = result.stdout.trim();
  const issueNumberMatch = issueUrl.match(/\/issues\/(\d+)/);

  const saved = await savePageStatus(config, {
    brandId: brand.id,
    projectId: project.id,
    url: payload.pageUrl,
    status: "issue",
    issueUrl,
    issueNumber: issueNumberMatch ? Number(issueNumberMatch[1]) : null,
    screenshotPath: screenshotFile ? path.relative(repoRoot, screenshotFile) : null
  });

  return { issueUrl, page: saved, screenshotPath: screenshotFile ? path.relative(repoRoot, screenshotFile) : null };
}

async function syncGit(config) {
  if (config.sync?.enabled === false) return { skipped: true, reason: "Sync disabled." };

  const branch = await ensureSyncBranch(config);
  const status = (await git(["status", "--short"])).stdout.trim();
  if (!status) return { skipped: true, reason: "No local changes." };

  await git(["add", "config", "data", "screenshots"]);
  const staged = (await git(["diff", "--cached", "--name-only"])).stdout.trim();
  if (!staged) return { skipped: true, reason: "No tracked QA changes to commit." };

  const count = pendingPageCount || 1;
  await git(["commit", "-m", `QA sync: ${count} pages processed [skip ci]`], { timeout: 60000 });

  try {
    await git(["pull", "--rebase", "origin", branch], { timeout: 60000 });
    await git(["push", "origin", branch], { timeout: 60000 });
  } catch (error) {
    return { pushed: false, committed: true, error: error.stderr || error.message };
  }

  pendingPageCount = 0;
  return { pushed: true };
}

function resetInactivityTimer(config) {
  if (syncTimer) clearTimeout(syncTimer);
  const seconds = config.sync?.inactivitySeconds || 600;
  syncTimer = setTimeout(async () => {
    if (pendingPageCount > 0) {
      try {
        await syncGit(config);
      } catch {
        // Surface explicit sync failures through the UI Sync Now action.
      }
    }
  }, seconds * 1000);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "Sitemap Sentinel",
    webPreferences: {
      preload: path.join(__dirname, "../preload/renderer.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  if (shouldUseDevServer()) {
    await mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    await mainWindow.loadFile(path.join(repoRoot, "dist/renderer/index.html"));
  }
}

ipcMain.handle("app:bootstrap", async () => {
  const config = await loadConfig();
  return {
    config,
    gh: await checkGhAuth(),
    user: await currentGitHubUser(),
    qaPreloadPath: path.join(__dirname, "../preload/qa-spy.js")
  };
});

ipcMain.handle("project:refresh", async (_event, payload) => {
  const config = await loadConfig();
  return loadProjectState(config, payload.brandId, payload.projectId);
});

ipcMain.handle("page:action", async (_event, payload) => {
  const config = await loadConfig();
  const page = await savePageStatus(config, payload);
  return { page };
});

ipcMain.handle("discovery:urls", async (_event, payload) => {
  const config = await loadConfig();
  return saveDiscoveredUrls(config, payload);
});

ipcMain.handle("recording:action", async (_event, payload) => {
  const config = await loadConfig();
  return saveRecordedAction(config, payload);
});

ipcMain.handle("issue:report", async (_event, payload) => {
  const config = await loadConfig();
  return createGitHubIssue(config, payload);
});

ipcMain.handle("git:sync", async () => {
  const config = await loadConfig();
  return syncGit(config);
});

ipcMain.handle("app:open-external", async (_event, url) => {
  await shell.openExternal(url);
  return { ok: true };
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", async (event) => {
  if (pendingPageCount <= 0) return;
  event.preventDefault();
  try {
    const config = await loadConfig();
    await syncGit(config);
  } finally {
    pendingPageCount = 0;
    app.quit();
  }
});
