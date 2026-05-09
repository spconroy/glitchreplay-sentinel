import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, Loader2, Plus, Save, Search, Trash2, Undo2 } from "lucide-react";
import type { AppConfig, Brand, Profile, Project } from "./types";

type Tab = "brands" | "global" | "profile";

type DraftProject = Project & { _uid: string; _idLocked?: boolean };
type DraftBrand = Omit<Brand, "projects"> & { _uid: string; _idLocked?: boolean; projects: DraftProject[] };
type DraftConfig = Omit<AppConfig, "brands"> & { brands: DraftBrand[] };

let uidCounter = 0;
function nextUid() {
  uidCounter += 1;
  return `uid_${uidCounter}_${Date.now().toString(36)}`;
}

function withUids(config: AppConfig): DraftConfig {
  return {
    ...structuredClone(config),
    brands: config.brands.map((brand) => ({
      ...brand,
      _uid: nextUid(),
      _idLocked: !!brand.id,
      projects: brand.projects.map((project) => ({
        ...project,
        _uid: nextUid(),
        _idLocked: !!project.id
      }))
    }))
  };
}

function stripUids(draft: DraftConfig): AppConfig {
  return {
    ...draft,
    brands: draft.brands.map((brand) => {
      const { _uid: _bUid, _idLocked: _bLock, projects, ...brandRest } = brand;
      return {
        ...brandRest,
        projects: projects.map((project) => {
          const { _uid: _pUid, _idLocked: _pLock, ...projectRest } = project;
          return projectRest;
        })
      };
    })
  };
}

const TAB_LABELS: Record<Tab, string> = {
  brands: "Brands & Projects",
  global: "Global Settings",
  profile: "Profile"
};

function slug(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

function multilineToArray(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function arrayToMultiline(value: string[] | undefined): string {
  return (value || []).join("\n");
}

function arrayToCsv(value: string[] | undefined): string {
  return (value || []).join(", ");
}

function csvToArray(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function emptyProject(): DraftProject {
  return {
    _uid: nextUid(),
    id: "new-project",
    name: "New Project",
    rootUrl: "",
    mode: "hybrid",
    githubRepo: ""
  };
}

function emptyBrand(): DraftBrand {
  return {
    _uid: nextUid(),
    id: "new-brand",
    name: "New Brand",
    projects: []
  };
}

type SettingsViewProps = {
  config: AppConfig;
  profile: Profile;
  onClose: () => void;
  onSaved: (next: { config: AppConfig; profile: Profile }) => void;
};

export function SettingsView({ config, profile, onClose, onSaved }: SettingsViewProps) {
  const [tab, setTab] = useState<Tab>("brands");
  const [draft, setDraft] = useState<DraftConfig>(() => withUids(config));
  const [reviewer, setReviewer] = useState(profile.reviewer || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeBrandUid, setActiveBrandUid] = useState<string>(() => withUids(config).brands[0]?._uid || "");

  useEffect(() => {
    const next = withUids(config);
    setDraft(next);
    setReviewer(profile.reviewer || "");
    setActiveBrandUid((current) =>
      next.brands.some((brand) => brand._uid === current) ? current : next.brands[0]?._uid || ""
    );
  }, [config, profile]);

  const dirty = useMemo(() => {
    const stripped = stripUids(draft);
    return JSON.stringify(stripped) !== JSON.stringify(config) || reviewer.trim() !== (profile.reviewer || "");
  }, [draft, config, reviewer, profile]);

  const activeBrand = useMemo(
    () => draft.brands.find((brand) => brand._uid === activeBrandUid) || draft.brands[0],
    [draft.brands, activeBrandUid]
  );

  function updateBrand(uid: string, patch: Partial<Omit<Brand, "projects">>) {
    setDraft((current) => ({
      ...current,
      brands: current.brands.map((brand) => {
        if (brand._uid !== uid) return brand;
        const next: DraftBrand = { ...brand, ...patch };
        if (patch.name !== undefined && !brand._idLocked) {
          next.id = slug(patch.name) || brand.id;
        }
        if (patch.id !== undefined) {
          next._idLocked = true;
        }
        return next;
      })
    }));
  }

  function updateProject(brandUid: string, projectUid: string, patch: Partial<Project>) {
    setDraft((current) => ({
      ...current,
      brands: current.brands.map((brand) =>
        brand._uid !== brandUid
          ? brand
          : {
              ...brand,
              projects: brand.projects.map((project) => {
                if (project._uid !== projectUid) return project;
                const next: DraftProject = { ...project, ...patch };
                if (patch.name !== undefined && !project._idLocked) {
                  next.id = slug(patch.name) || project.id;
                }
                if (patch.id !== undefined) {
                  next._idLocked = true;
                }
                return next;
              })
            }
      )
    }));
  }

  function addBrand() {
    const brand = emptyBrand();
    setDraft((current) => ({ ...current, brands: [...current.brands, brand] }));
    setActiveBrandUid(brand._uid);
  }

  function removeBrand(uid: string) {
    if (!confirm("Remove this brand and all its projects from the config?")) return;
    setDraft((current) => ({ ...current, brands: current.brands.filter((brand) => brand._uid !== uid) }));
    setActiveBrandUid((current) => {
      if (current !== uid) return current;
      const remaining = draft.brands.filter((brand) => brand._uid !== uid);
      return remaining[0]?._uid || "";
    });
  }

  function addProject(brandUid: string) {
    setDraft((current) => ({
      ...current,
      brands: current.brands.map((brand) =>
        brand._uid !== brandUid ? brand : { ...brand, projects: [...brand.projects, emptyProject()] }
      )
    }));
  }

  function removeProject(brandUid: string, projectUid: string) {
    if (!confirm("Remove this project from the config?")) return;
    setDraft((current) => ({
      ...current,
      brands: current.brands.map((brand) =>
        brand._uid !== brandUid
          ? brand
          : { ...brand, projects: brand.projects.filter((project) => project._uid !== projectUid) }
      )
    }));
  }

  function updateSync(patch: Partial<NonNullable<AppConfig["sync"]>>) {
    setDraft((current) => ({ ...current, sync: { ...(current.sync || {}), ...patch } }));
  }

  function updateGithub(patch: Partial<NonNullable<AppConfig["github"]>>) {
    setDraft((current) => ({ ...current, github: { ...(current.github || {}), ...patch } }));
  }

  function updateScreenshots(patch: Partial<NonNullable<AppConfig["screenshots"]>>) {
    setDraft((current) => ({ ...current, screenshots: { ...(current.screenshots || {}), ...patch } }));
  }

  function updateDiscovery(patch: Partial<NonNullable<AppConfig["discovery"]>>) {
    setDraft((current) => ({ ...current, discovery: { ...(current.discovery || {}), ...patch } }));
  }

  function discard() {
    setDraft(withUids(config));
    setReviewer(profile.reviewer || "");
    setError("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const savedConfig = await window.sentinel.saveConfig(stripUids(draft));
      const trimmedReviewer = reviewer.trim();
      let savedProfile: Profile = profile;
      if (trimmedReviewer !== (profile.reviewer || "")) {
        savedProfile = await window.sentinel.saveProfile({ schemaVersion: 1, reviewer: trimmedReviewer });
      }
      onSaved({ config: savedConfig, profile: savedProfile });
    } catch (err: any) {
      setError(err?.message || "Failed to save configuration.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="settings-shell">
      <header className="settings-header">
        <button className="settings-back" onClick={onClose} disabled={saving}>
          <ArrowLeft size={16} />
          Back to review
        </button>
        <div className="settings-tabs">
          {(Object.keys(TAB_LABELS) as Tab[]).map((key) => (
            <button
              key={key}
              className={tab === key ? "settings-tab active" : "settings-tab"}
              onClick={() => setTab(key)}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>
        <div className="settings-actions">
          {dirty && (
            <button className="settings-button ghost" onClick={discard} disabled={saving}>
              <Undo2 size={14} />
              Discard
            </button>
          )}
          <button className="settings-button primary" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {saving ? "Saving" : "Save changes"}
          </button>
        </div>
      </header>

      {error && <div className="settings-error">{error}</div>}

      <div className="settings-body">
        {tab === "brands" && (
          <BrandsTab
            brands={draft.brands}
            activeBrand={activeBrand}
            onSelectBrand={setActiveBrandUid}
            onAddBrand={addBrand}
            onRemoveBrand={removeBrand}
            onUpdateBrand={updateBrand}
            onAddProject={addProject}
            onRemoveProject={removeProject}
            onUpdateProject={updateProject}
          />
        )}

        {tab === "global" && (
          <GlobalTab
            config={draft}
            onSyncChange={updateSync}
            onGithubChange={updateGithub}
            onScreenshotsChange={updateScreenshots}
            onDiscoveryChange={updateDiscovery}
          />
        )}

        {tab === "profile" && <ProfileTab reviewer={reviewer} onReviewerChange={setReviewer} />}
      </div>
    </main>
  );
}

type BrandsTabProps = {
  brands: DraftBrand[];
  activeBrand: DraftBrand | undefined;
  onSelectBrand: (uid: string) => void;
  onAddBrand: () => void;
  onRemoveBrand: (uid: string) => void;
  onUpdateBrand: (uid: string, patch: Partial<Omit<Brand, "projects">>) => void;
  onAddProject: (brandUid: string) => void;
  onRemoveProject: (brandUid: string, projectUid: string) => void;
  onUpdateProject: (brandUid: string, projectUid: string, patch: Partial<Project>) => void;
};

function BrandsTab(props: BrandsTabProps) {
  const {
    brands,
    activeBrand,
    onSelectBrand,
    onAddBrand,
    onRemoveBrand,
    onUpdateBrand,
    onAddProject,
    onRemoveProject,
    onUpdateProject
  } = props;

  return (
    <div className="brands-pane">
      <aside className="brand-list">
        <div className="brand-list-head">
          <h2>Brands</h2>
          <button className="settings-button ghost" onClick={onAddBrand}>
            <Plus size={14} />
            Add
          </button>
        </div>
        {brands.length === 0 && <p className="muted">No brands yet — add one to get started.</p>}
        {brands.map((brand) => (
          <button
            key={brand._uid}
            className={`brand-list-item ${activeBrand?._uid === brand._uid ? "active" : ""}`}
            onClick={() => onSelectBrand(brand._uid)}
          >
            <span className="brand-list-name">{brand.name || "Untitled brand"}</span>
            <span className="brand-list-meta">
              {brand.projects.length} project{brand.projects.length === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </aside>

      <div className="brand-editor">
        {!activeBrand && <p className="muted">Select or add a brand to edit its details.</p>}
        {activeBrand && (
          <BrandEditor
            brand={activeBrand}
            onRemove={() => onRemoveBrand(activeBrand._uid)}
            onUpdate={(patch) => onUpdateBrand(activeBrand._uid, patch)}
            onAddProject={() => onAddProject(activeBrand._uid)}
            onRemoveProject={(projectUid) => onRemoveProject(activeBrand._uid, projectUid)}
            onUpdateProject={(projectUid, patch) => onUpdateProject(activeBrand._uid, projectUid, patch)}
          />
        )}
      </div>
    </div>
  );
}

type BrandEditorProps = {
  brand: DraftBrand;
  onRemove: () => void;
  onUpdate: (patch: Partial<Omit<Brand, "projects">>) => void;
  onAddProject: () => void;
  onRemoveProject: (projectUid: string) => void;
  onUpdateProject: (projectUid: string, patch: Partial<Project>) => void;
};

function BrandEditor({
  brand,
  onRemove,
  onUpdate,
  onAddProject,
  onRemoveProject,
  onUpdateProject
}: BrandEditorProps) {
  return (
    <div className="brand-editor-inner">
      <div className="card">
        <div className="card-head">
          <h3>{brand.name || "Untitled brand"}</h3>
          <button className="settings-button danger ghost" onClick={onRemove}>
            <Trash2 size={14} />
            Remove brand
          </button>
        </div>
        <Field label="Brand name" required>
          <input
            value={brand.name}
            onChange={(event) => onUpdate({ name: event.target.value })}
            placeholder="Acme"
          />
        </Field>
        <Disclosure title="Advanced">
          <Field label="Brand ID" hint="Auto-generated from the name. Used in folder paths.">
            <input
              value={brand.id}
              onChange={(event) => onUpdate({ id: slug(event.target.value) })}
              placeholder="acme"
            />
          </Field>
        </Disclosure>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Projects</h3>
          <button className="settings-button" onClick={onAddProject}>
            <Plus size={14} />
            Add project
          </button>
        </div>
        {brand.projects.length === 0 && <p className="muted">No projects in this brand yet.</p>}
        {brand.projects.map((project) => (
          <ProjectEditor
            key={project._uid}
            project={project}
            onRemove={() => onRemoveProject(project._uid)}
            onUpdate={(patch) => onUpdateProject(project._uid, patch)}
          />
        ))}
      </div>
    </div>
  );
}

type ProjectEditorProps = {
  project: DraftProject;
  onRemove: () => void;
  onUpdate: (patch: Partial<Project>) => void;
};

function ProjectEditor({ project, onRemove, onUpdate }: ProjectEditorProps) {
  const [detecting, setDetecting] = useState(false);
  const [detectMessage, setDetectMessage] = useState("");
  const showSitemaps = project.mode !== "discover";
  const showSeeds = project.mode !== "sitemap";

  async function detectSitemaps() {
    const rootUrl = project.rootUrl.trim();
    if (!rootUrl) {
      setDetectMessage("Add a Root URL first.");
      return;
    }
    setDetecting(true);
    setDetectMessage("");
    try {
      const result = await window.sentinel.detectSitemaps(rootUrl);
      const found = result.sitemaps;
      if (found.length === 0) {
        setDetectMessage("No sitemaps found via robots.txt or standard paths.");
        return;
      }
      const existing = new Set(project.sitemaps || []);
      const merged = [...(project.sitemaps || [])];
      let added = 0;
      for (const url of found) {
        if (!existing.has(url)) {
          merged.push(url);
          added += 1;
        }
      }
      onUpdate({ sitemaps: merged });
      setDetectMessage(
        added === 0
          ? `Already had all ${found.length} detected sitemap${found.length === 1 ? "" : "s"}.`
          : `Added ${added} sitemap${added === 1 ? "" : "s"}.`
      );
    } catch (error: any) {
      setDetectMessage(error?.message || "Detection failed.");
    } finally {
      setDetecting(false);
    }
  }

  return (
    <div className="project-card">
      <div className="card-head">
        <h4>{project.name || "Untitled project"}</h4>
        <button className="settings-button danger ghost" onClick={onRemove}>
          <Trash2 size={14} />
          Remove
        </button>
      </div>

      <div className="grid two">
        <Field label="Project name" required>
          <input
            value={project.name}
            onChange={(event) => onUpdate({ name: event.target.value })}
            placeholder="Marketing site"
          />
        </Field>
        <Field label="Root URL" required>
          <input
            value={project.rootUrl}
            onChange={(event) => onUpdate({ rootUrl: event.target.value })}
            placeholder="https://example.com"
          />
        </Field>
      </div>

      <div className="grid two">
        <Field label="GitHub repo" hint="owner/repo — required to file issues.">
          <input
            value={project.githubRepo}
            onChange={(event) => onUpdate({ githubRepo: event.target.value })}
            placeholder="owner/repo"
          />
        </Field>
        <Field label="Discovery mode">
          <select
            value={project.mode}
            onChange={(event) => onUpdate({ mode: event.target.value as Project["mode"] })}
          >
            <option value="hybrid">Hybrid — sitemaps + crawl</option>
            <option value="sitemap">Sitemap only</option>
            <option value="discover">Crawl only</option>
          </select>
        </Field>
      </div>

      {showSitemaps && (
        <Field
          label="Sitemap URLs"
          optional
          hint="One URL per line. If left empty, sitemaps are auto-detected from robots.txt at refresh time."
        >
          <textarea
            value={arrayToMultiline(project.sitemaps)}
            onChange={(event) => onUpdate({ sitemaps: multilineToArray(event.target.value) })}
            placeholder="https://example.com/sitemap.xml"
            rows={2}
          />
          <div className="field-action-row">
            <button
              type="button"
              className="settings-button ghost"
              onClick={detectSitemaps}
              disabled={detecting || !project.rootUrl.trim()}
            >
              {detecting ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
              {detecting ? "Detecting…" : "Auto-detect now"}
            </button>
            {detectMessage && <span className="muted">{detectMessage}</span>}
          </div>
        </Field>
      )}
      {showSeeds && (
        <Field label="Seed URLs" optional hint="One URL per line. Starting points for the crawler.">
          <textarea
            value={arrayToMultiline(project.seedUrls)}
            onChange={(event) => onUpdate({ seedUrls: multilineToArray(event.target.value) })}
            placeholder="https://example.com/start"
            rows={2}
          />
        </Field>
      )}

      <Disclosure title="Advanced settings">
        <Field label="Project ID" hint="Auto-generated from name. Used in data paths.">
          <input
            value={project.id}
            onChange={(event) => onUpdate({ id: slug(event.target.value) })}
            placeholder="marketing"
          />
        </Field>

        <Field label="Webview partition" optional hint="persist:NAME — share login state across projects of the same brand.">
          <input
            value={project.webviewPartition || ""}
            onChange={(event) => onUpdate({ webviewPartition: event.target.value })}
            placeholder={`persist:${project.id || "brand"}`}
          />
        </Field>

        <div className="grid two">
          <Field label="Issue labels" optional hint="Comma separated. Applied to filed issues.">
            <input
              value={arrayToCsv(project.labels)}
              onChange={(event) => onUpdate({ labels: csvToArray(event.target.value) })}
              placeholder="qa, website"
            />
          </Field>
          <Field label="Allowed extra domains" optional hint="Comma separated. Lets the crawler follow links to these hosts.">
            <input
              value={arrayToCsv(project.allowedDomains)}
              onChange={(event) => onUpdate({ allowedDomains: csvToArray(event.target.value) })}
              placeholder="cdn.example.com"
            />
          </Field>
        </div>

        <Field label="Ignore URL patterns" optional hint="One per line. Substring match against URLs.">
          <textarea
            value={arrayToMultiline(project.ignorePatterns)}
            onChange={(event) => onUpdate({ ignorePatterns: multilineToArray(event.target.value) })}
            placeholder="/wp-admin"
            rows={2}
          />
        </Field>

        <div className="grid two">
          <Field label="Query string handling" optional hint="Override the global default for this project.">
            <select
              value={project.queryStringMode || ""}
              onChange={(event) =>
                onUpdate({ queryStringMode: (event.target.value || undefined) as Project["queryStringMode"] })
              }
            >
              <option value="">Use global default</option>
              <option value="strip-tracking">Strip tracking params</option>
              <option value="strip-all">Strip all query params</option>
              <option value="allowlist">Keep only allowlist</option>
              <option value="preserve">Keep all query strings</option>
            </select>
          </Field>
          <Field label="Allowed query params" optional hint="Used when handling = allowlist.">
            <input
              value={arrayToCsv(project.allowedQueryParams)}
              onChange={(event) => onUpdate({ allowedQueryParams: csvToArray(event.target.value) })}
              placeholder="page, category"
            />
          </Field>
        </div>

        <div className="checkbox-row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={project.recordActions !== false}
              onChange={(event) => onUpdate({ recordActions: event.target.checked })}
            />
            Record clicks &amp; form actions for issue replays
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={project.includeSubdomains === true}
              onChange={(event) => onUpdate({ includeSubdomains: event.target.checked })}
            />
            Include subdomains of the root URL
          </label>
        </div>
      </Disclosure>
    </div>
  );
}

type GlobalTabProps = {
  config: DraftConfig;
  onSyncChange: (patch: Partial<NonNullable<AppConfig["sync"]>>) => void;
  onGithubChange: (patch: Partial<NonNullable<AppConfig["github"]>>) => void;
  onScreenshotsChange: (patch: Partial<NonNullable<AppConfig["screenshots"]>>) => void;
  onDiscoveryChange: (patch: Partial<NonNullable<AppConfig["discovery"]>>) => void;
};

function GlobalTab({ config, onSyncChange, onGithubChange, onScreenshotsChange, onDiscoveryChange }: GlobalTabProps) {
  const sync = config.sync || {};
  const github = config.github || {};
  const screenshots = config.screenshots || {};
  const discovery = config.discovery || {};

  return (
    <div className="global-pane">
      <section className="card">
        <h3>Sync</h3>
        <p className="muted">How QA progress is committed and pushed to git.</p>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={sync.enabled !== false}
            onChange={(event) => onSyncChange({ enabled: event.target.checked })}
          />
          Auto-commit and push QA changes to git
        </label>
        <Field label="Branch strategy">
          <select
            value={sync.branchStrategy || "per-user"}
            onChange={(event) =>
              onSyncChange({ branchStrategy: event.target.value as NonNullable<AppConfig["sync"]>["branchStrategy"] })
            }
          >
            <option value="per-user">Per reviewer (one branch each)</option>
            <option value="per-project">Per project (shared)</option>
            <option value="current-branch">Whatever branch is checked out</option>
          </select>
        </Field>
        <Disclosure title="Advanced sync">
          <div className="grid two">
            <Field label="Branch prefix" optional>
              <input
                value={sync.branchPrefix || "qa"}
                onChange={(event) => onSyncChange({ branchPrefix: event.target.value })}
                placeholder="qa"
              />
            </Field>
            <Field label="Inactivity sync (seconds)" optional hint="Auto-sync after this much idle time.">
              <input
                type="number"
                min={30}
                value={sync.inactivitySeconds ?? 600}
                onChange={(event) => onSyncChange({ inactivitySeconds: Number(event.target.value) })}
              />
            </Field>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={sync.allowSameBranchCollaboration === true}
              onChange={(event) => onSyncChange({ allowSameBranchCollaboration: event.target.checked })}
            />
            Allow multiple reviewers to share a sync branch
          </label>
        </Disclosure>
      </section>

      <section className="card">
        <h3>Screenshots</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={screenshots.commitScreenshots !== false}
            onChange={(event) => onScreenshotsChange({ commitScreenshots: event.target.checked })}
          />
          Commit screenshot files when syncing
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={screenshots.deleteAfterIssueCreation === true}
            onChange={(event) => onScreenshotsChange({ deleteAfterIssueCreation: event.target.checked })}
          />
          Delete the local screenshot after the issue is filed
        </label>
        <Disclosure title="Advanced">
          <Field label="Storage location" optional>
            <select
              value={screenshots.storage || "repo"}
              onChange={(event) =>
                onScreenshotsChange({
                  storage: event.target.value as NonNullable<AppConfig["screenshots"]>["storage"]
                })
              }
            >
              <option value="repo">In this checkout (screenshots/)</option>
              <option value="external">Outside the repo</option>
            </select>
          </Field>
        </Disclosure>
      </section>

      <section className="card">
        <h3>Discovery</h3>
        <Field label="Default query string handling">
          <select
            value={discovery.queryStringMode || "strip-tracking"}
            onChange={(event) =>
              onDiscoveryChange({
                queryStringMode: event.target.value as NonNullable<AppConfig["discovery"]>["queryStringMode"]
              })
            }
          >
            <option value="strip-tracking">Strip tracking params (utm, fbclid, …)</option>
            <option value="strip-all">Strip all query params</option>
            <option value="allowlist">Keep only allowlisted params</option>
            <option value="preserve">Keep query strings as-is</option>
          </select>
        </Field>
        <Disclosure title="Advanced">
          <Field label="Tracking parameters" optional hint="Comma separated. Wildcards like utm_* are supported.">
            <input
              value={arrayToCsv(discovery.trackingParams)}
              onChange={(event) => onDiscoveryChange({ trackingParams: csvToArray(event.target.value) })}
              placeholder="utm_*, fbclid, gclid"
            />
          </Field>
        </Disclosure>
      </section>

      <section className="card">
        <h3>GitHub CLI</h3>
        <Disclosure title="Advanced">
          <Field label="CLI preference">
            <select
              value={github.cliPreference || "system-first"}
              onChange={(event) =>
                onGithubChange({
                  cliPreference: event.target.value as NonNullable<AppConfig["github"]>["cliPreference"]
                })
              }
            >
              <option value="system-first">Prefer system gh, fall back to bundled</option>
              <option value="bundled-first">Prefer bundled gh, fall back to system</option>
              <option value="system-only">System gh only</option>
              <option value="bundled-only">Bundled gh only</option>
            </select>
          </Field>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={github.bundledGhFallback !== false}
              onChange={(event) => onGithubChange({ bundledGhFallback: event.target.checked })}
            />
            Allow falling back to a bundled gh binary
          </label>
        </Disclosure>
      </section>
    </div>
  );
}

function ProfileTab({ reviewer, onReviewerChange }: { reviewer: string; onReviewerChange: (value: string) => void }) {
  return (
    <div className="profile-pane">
      <section className="card">
        <h3>Reviewer profile</h3>
        <p className="muted">Recorded on every page review and used as the GitHub issue reporter.</p>
        <Field label="Reviewer name or email">
          <input
            value={reviewer}
            onChange={(event) => onReviewerChange(event.target.value)}
            placeholder="jane@example.com"
          />
        </Field>
      </section>
    </div>
  );
}

type FieldProps = {
  label: string;
  hint?: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
};

function Field({ label, hint, required, optional, children }: FieldProps) {
  return (
    <div className="settings-field">
      <span className="settings-field-label">
        {label}
        {required && <span className="settings-field-required" aria-label="required">*</span>}
        {optional && <span className="settings-field-optional">(optional)</span>}
      </span>
      {children}
      {hint && <span className="settings-field-hint">{hint}</span>}
    </div>
  );
}

function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? "disclosure open" : "disclosure"}>
      <button type="button" className="disclosure-toggle" onClick={() => setOpen((current) => !current)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  );
}
