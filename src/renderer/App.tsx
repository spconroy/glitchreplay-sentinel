import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  FileQuestion,
  Filter,
  Github,
  Loader2,
  RefreshCw,
  Search,
  Send,
  SkipForward,
  X
} from "lucide-react";
import type { Bootstrap, Brand, Evidence, Project, QaPage } from "./types";

type FilterKey = "needs" | "new" | "updated" | "issues" | "approved" | "skipped" | "ignored" | "all";

const filterLabels: Record<FilterKey, string> = {
  needs: "Needs Review",
  new: "New",
  updated: "Updated",
  issues: "Issues",
  approved: "Approved",
  skipped: "Skipped",
  ignored: "Ignored",
  all: "All"
};

function statusLabel(status: QaPage["status"]) {
  return status.replace("_", " ");
}

function statusClass(status: QaPage["status"]) {
  return `status status-${status}`;
}

function shortUrl(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || "/"}${parsed.search}`;
  } catch {
    return url;
  }
}

function emptyEvidence(): Evidence {
  return {
    consoleErrors: [],
    networkFailures: [],
    metadata: {},
    recordedSteps: []
  };
}

export function App() {
  const webviewRef = useRef<any>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [brandId, setBrandId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [pages, setPages] = useState<QaPage[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [filter, setFilter] = useState<FilterKey>("needs");
  const [query, setQuery] = useState("");
  const [notes, setNotes] = useState("");
  const [evidence, setEvidence] = useState<Evidence>(emptyEvidence);
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [webContentsId, setWebContentsId] = useState<number | undefined>();

  useEffect(() => {
    window.sentinel.bootstrap().then((result) => {
      setBootstrap(result);
      const firstBrand = result.config.brands[0];
      const firstProject = firstBrand?.projects[0];
      if (firstBrand && firstProject) {
        setBrandId(firstBrand.id);
        setProjectId(firstProject.id);
      }
      setLoading(false);
    });
  }, []);

  const brand: Brand | undefined = useMemo(
    () => bootstrap?.config.brands.find((item) => item.id === brandId),
    [bootstrap, brandId]
  );
  const project: Project | undefined = useMemo(
    () => brand?.projects.find((item) => item.id === projectId),
    [brand, projectId]
  );
  const selectedPage = useMemo(() => pages.find((page) => page.url === selectedUrl), [pages, selectedUrl]);

  const filteredPages = useMemo(() => {
    return pages.filter((page) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "needs" && page.needsReview) ||
        (filter === "new" && page.isNew) ||
        (filter === "updated" && page.isModified) ||
        (filter === "issues" && page.status === "issue") ||
        (filter === "approved" && page.status === "approved") ||
        (filter === "skipped" && page.status === "skipped") ||
        (filter === "ignored" && page.status === "ignored");
      const matchesQuery = !query || page.url.toLowerCase().includes(query.toLowerCase());
      return matchesFilter && matchesQuery;
    });
  }, [pages, filter, query]);

  const counts = useMemo(() => {
    return {
      total: pages.length,
      needs: pages.filter((page) => page.needsReview).length,
      approved: pages.filter((page) => page.status === "approved").length,
      issues: pages.filter((page) => page.status === "issue").length
    };
  }, [pages]);

  async function refreshProject(nextBrandId = brandId, nextProjectId = projectId) {
    if (!nextBrandId || !nextProjectId) return;
    setBusy("Loading project");
    try {
      const state = await window.sentinel.refreshProject({ brandId: nextBrandId, projectId: nextProjectId });
      setPages(state.pages);
      setWarnings(state.warnings);
      const first = state.pages.find((page) => page.needsReview) || state.pages[0];
      setSelectedUrl(first?.url || state.project.rootUrl);
      setNotes("");
      setEvidence(emptyEvidence());
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (brandId && projectId) refreshProject(brandId, projectId);
  }, [brandId, projectId]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) return;

    const onStart = () => {
      setPageLoading(true);
      setEvidence(emptyEvidence());
    };
    const onDomReady = async () => {
      setPageLoading(false);
      setWebContentsId(webview.getWebContentsId());
      try {
        const metadata = await webview.executeJavaScript(`({
          userAgent: navigator.userAgent,
          viewport: window.innerWidth + "x" + window.innerHeight,
          deviceScaleFactor: window.devicePixelRatio,
          title: document.title
        })`);
        setEvidence((current) => ({ ...current, metadata }));
      } catch {
        // Metadata is useful but not required.
      }
    };
    const onConsole = (event: any) => {
      if (!["error", "warning"].includes(event.level)) return;
      setEvidence((current) => ({
        ...current,
        consoleErrors: [
          ...current.consoleErrors,
          {
            level: event.level,
            message: event.message,
            source: event.sourceId,
            line: event.line,
            timestamp: new Date().toISOString()
          }
        ]
      }));
    };
    const onFailLoad = (event: any) => {
      if (event.isMainFrame && event.errorCode !== -3) {
        setEvidence((current) => ({
          ...current,
          networkFailures: [
            ...current.networkFailures,
            {
              url: event.validatedURL || selectedUrl,
              error: event.errorDescription,
              timestamp: new Date().toISOString()
            }
          ]
        }));
      }
      setPageLoading(false);
    };
    const onIpc = (event: any) => {
      if (!brand || !project) return;
      if (event.channel === "discovered-urls") {
        window.sentinel
          .saveDiscoveredUrls({
            brandId: brand.id,
            projectId: project.id,
            pageUrl: event.args[0].pageUrl,
            urls: event.args[0].urls
          })
          .then((result) => {
            if (result.added.length > 0) refreshProject(brand.id, project.id);
          });
      }
      if (event.channel === "record-action") {
        const action = event.args[0];
        setEvidence((current) => ({ ...current, recordedSteps: [...current.recordedSteps, action] }));
        window.sentinel.saveRecordedAction({
          brandId: brand.id,
          projectId: project.id,
          pageUrl: action.pageUrl,
          action
        });
      }
    };

    webview.addEventListener("did-start-loading", onStart);
    webview.addEventListener("dom-ready", onDomReady);
    webview.addEventListener("console-message", onConsole);
    webview.addEventListener("did-fail-load", onFailLoad);
    webview.addEventListener("ipc-message", onIpc);

    return () => {
      webview.removeEventListener("did-start-loading", onStart);
      webview.removeEventListener("dom-ready", onDomReady);
      webview.removeEventListener("console-message", onConsole);
      webview.removeEventListener("did-fail-load", onFailLoad);
      webview.removeEventListener("ipc-message", onIpc);
    };
  }, [brand, project, selectedUrl]);

  function selectNextPage(currentUrl = selectedUrl) {
    const currentIndex = filteredPages.findIndex((page) => page.url === currentUrl);
    const next = filteredPages[currentIndex + 1] || filteredPages.find((page) => page.url !== currentUrl);
    if (next) setSelectedUrl(next.url);
  }

  async function pageAction(status: QaPage["status"]) {
    if (!brand || !project || !selectedPage) return;
    setBusy(statusLabel(status));
    try {
      await window.sentinel.savePageAction({
        brandId: brand.id,
        projectId: project.id,
        url: selectedPage.url,
        status,
        source: selectedPage.source,
        sitemapLastmod: selectedPage.sitemapLastmod
      });
      await refreshProject(brand.id, project.id);
      selectNextPage(selectedPage.url);
    } finally {
      setBusy("");
    }
  }

  async function reportIssue() {
    if (!brand || !project || !selectedPage) return;
    if (!notes.trim() && evidence.consoleErrors.length === 0 && evidence.networkFailures.length === 0) {
      setMessage("Add notes or capture a technical error before reporting.");
      return;
    }

    setBusy("Creating GitHub issue");
    try {
      const result = await window.sentinel.reportIssue({
        brandId: brand.id,
        projectId: project.id,
        pageUrl: selectedPage.url,
        notes: notes.trim() || "Technical issue captured by Sitemap Sentinel.",
        webContentsId,
        evidence
      });
      setMessage(`Created GitHub issue: ${result.issueUrl}`);
      setNotes("");
      await refreshProject(brand.id, project.id);
      selectNextPage(selectedPage.url);
    } catch (error: any) {
      setMessage(error.message || "Failed to create GitHub issue.");
    } finally {
      setBusy("");
    }
  }

  async function syncNow() {
    setBusy("Syncing");
    try {
      const result = await window.sentinel.syncNow();
      setMessage(JSON.stringify(result));
    } catch (error: any) {
      setMessage(error.message || "Sync failed.");
    } finally {
      setBusy("");
    }
  }

  if (loading || !bootstrap) {
    return (
      <main className="loading-screen">
        <Loader2 className="spin" />
        <span>Loading Sitemap Sentinel</span>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <div>
            <h1>Sitemap Sentinel</h1>
            <p>{bootstrap.user}</p>
          </div>
          <button className="icon-button" onClick={syncNow} title="Sync now">
            <RefreshCw size={18} />
          </button>
        </div>

        <div className={bootstrap.gh.authenticated ? "auth ok" : "auth warn"}>
          <Github size={16} />
          <span>{bootstrap.gh.authenticated ? "GitHub CLI authenticated" : "GitHub auth required"}</span>
        </div>

        <label>
          Brand
          <select
            value={brandId}
            onChange={(event) => {
              const nextBrandId = event.target.value;
              const nextBrand = bootstrap.config.brands.find((item) => item.id === nextBrandId);
              setBrandId(nextBrandId);
              setProjectId(nextBrand?.projects[0]?.id || "");
            }}
          >
            {bootstrap.config.brands.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Project
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {brand?.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <div className="stats">
          <span>{counts.needs} needs review</span>
          <span>{counts.approved} approved</span>
          <span>{counts.issues} issues</span>
          <span>{counts.total} total</span>
        </div>

        <div className="search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search URLs" />
        </div>

        <div className="filters">
          {(Object.keys(filterLabels) as FilterKey[]).map((key) => (
            <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>
              {key === "needs" && <Filter size={14} />}
              {filterLabels[key]}
            </button>
          ))}
        </div>

        {warnings.length > 0 && (
          <div className="warnings">
            {warnings.map((warning) => (
              <div key={warning}>
                <AlertCircle size={14} />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}

        <div className="page-list">
          {filteredPages.map((page) => (
            <button
              key={page.url}
              className={page.url === selectedUrl ? "page-row selected" : "page-row"}
              onClick={() => setSelectedUrl(page.url)}
            >
              <span className={statusClass(page.status)}>{statusLabel(page.status)}</span>
              <span className="page-url">{shortUrl(page.url)}</span>
              <span className="page-source">{page.source}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="reviewer">
        <header className="toolbar">
          <div className="url-block">
            <strong>{project?.name}</strong>
            <span>{selectedUrl}</span>
          </div>
          <div className="toolbar-actions">
            {pageLoading && <Loader2 className="spin" size={18} />}
            <button className="icon-button" onClick={() => webviewRef.current?.reload()} title="Reload">
              <RefreshCw size={18} />
            </button>
            <button className="icon-button" onClick={() => selectedUrl && window.sentinel.openExternal(selectedUrl)} title="Open externally">
              <ExternalLink size={18} />
            </button>
          </div>
        </header>

        <div className="webview-wrap">
          {selectedUrl ? (
            <webview
              ref={webviewRef}
              src={selectedUrl}
              preload={bootstrap.qaPreloadPath}
              partition={project?.webviewPartition || `persist:${project?.id || "default"}`}
              allowpopups
            />
          ) : (
            <div className="empty-state">
              <FileQuestion />
              <span>No pages found for this project.</span>
            </div>
          )}
        </div>
      </section>

      <aside className="inspector">
        <div className="inspector-head">
          <h2>Review</h2>
          {busy && <span>{busy}</span>}
        </div>

        {selectedPage && (
          <div className="current-card">
            <span className={statusClass(selectedPage.status)}>{statusLabel(selectedPage.status)}</span>
            <strong>{shortUrl(selectedPage.url)}</strong>
            <small>{selectedPage.lastInspectedAt ? `Last checked ${selectedPage.lastInspectedAt}` : "Not reviewed yet"}</small>
          </div>
        )}

        <label>
          Notes
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Describe what needs to be fixed." />
        </label>

        <div className="action-grid">
          <button onClick={() => pageAction("approved")} disabled={!selectedPage || Boolean(busy)} className="approve">
            <Check size={16} />
            Approve
          </button>
          <button onClick={reportIssue} disabled={!selectedPage || Boolean(busy)} className="issue">
            <Send size={16} />
            Report Issue
          </button>
          <button onClick={() => pageAction("skipped")} disabled={!selectedPage || Boolean(busy)}>
            <SkipForward size={16} />
            Skip
          </button>
          <button onClick={() => pageAction("ignored")} disabled={!selectedPage || Boolean(busy)}>
            <X size={16} />
            Ignore
          </button>
        </div>

        <EvidencePanel evidence={evidence} />

        {message && <div className="message">{message}</div>}
      </aside>
    </main>
  );
}

function EvidencePanel({ evidence }: { evidence: Evidence }) {
  return (
    <div className="evidence">
      <h3>Captured Evidence</h3>
      <div className="evidence-counts">
        <span>{evidence.consoleErrors.length} console</span>
        <span>{evidence.networkFailures.length} network</span>
        <span>{evidence.recordedSteps.length} steps</span>
      </div>

      {evidence.consoleErrors.slice(-5).map((entry, index) => (
        <div className="evidence-item" key={`console-${index}`}>
          <strong>{entry.level}</strong>
          <span>{entry.message}</span>
        </div>
      ))}

      {evidence.networkFailures.slice(-5).map((entry, index) => (
        <div className="evidence-item" key={`network-${index}`}>
          <strong>{entry.status || "load"}</strong>
          <span>{entry.url}</span>
        </div>
      ))}
    </div>
  );
}
