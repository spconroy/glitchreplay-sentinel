import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, Plus, Save, Trash2, Undo2 } from "lucide-react";
import type { AppConfig, Brand, Profile, Project } from "./types";

type Tab = "brands" | "global" | "profile";

type SettingsViewProps = {
  config: AppConfig;
  profile: Profile;
  onClose: () => void;
  onSaved: (next: { config: AppConfig; profile: Profile }) => void;
};

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

function emptyProject(suggestedId: string): Project {
  return {
    id: suggestedId,
    name: "New Project",
    rootUrl: "",
    mode: "hybrid",
    githubRepo: ""
  };
}

function emptyBrand(suggestedId: string): Brand {
  return {
    id: suggestedId,
    name: "New Brand",
    projects: []
  };
}

function uniqueId(base: string, taken: Set<string>): string {
  let candidate = base;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}

export function SettingsView({ config, profile, onClose, onSaved }: SettingsViewProps) {
  const [tab, setTab] = useState<Tab>("brands");
  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(config));
  const [reviewer, setReviewer] = useState(profile.reviewer || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeBrandId, setActiveBrandId] = useState<string>(config.brands[0]?.id || "");

  useEffect(() => {
    setDraft(structuredClone(config));
    setReviewer(profile.reviewer || "");
  }, [config, profile]);

  const dirty = useMemo(() => {
    return JSON.stringify(draft) !== JSON.stringify(config) || reviewer.trim() !== (profile.reviewer || "");
  }, [draft, config, reviewer, profile]);

  const activeBrand = useMemo(
    () => draft.brands.find((brand) => brand.id === activeBrandId) || draft.brands[0],
    [draft.brands, activeBrandId]
  );

  function updateBrand(brandId: string, patch: Partial<Brand>) {
    setDraft((current) => ({
      ...current,
      brands: current.brands.map((brand) => (brand.id === brandId ? { ...brand, ...patch } : brand))
    }));
    if (patch.id && patch.id !== brandId) setActiveBrandId(patch.id);
  }

  function updateProject(brandId: string, projectId: string, patch: Partial<Project>) {
    setDraft((current) => ({
      ...current,
      brands: current.brands.map((brand) =>
        brand.id === brandId
          ? {
              ...brand,
              projects: brand.projects.map((project) =>
                project.id === projectId ? { ...project, ...patch } : project
              )
            }
          : brand
      )
    }));
  }

  function addBrand() {
    const taken = new Set(draft.brands.map((brand) => brand.id));
    const id = uniqueId("new-brand", taken);
    setDraft((current) => ({ ...current, brands: [...current.brands, emptyBrand(id)] }));
    setActiveBrandId(id);
  }

  function removeBrand(brandId: string) {
    if (!confirm("Remove this brand and all its projects from the config?")) return;
    setDraft((current) => {
      const brands = current.brands.filter((brand) => brand.id !== brandId);
      return { ...current, brands };
    });
    setActiveBrandId((current) => {
      if (current !== brandId) return current;
      const remaining = draft.brands.filter((brand) => brand.id !== brandId);
      return remaining[0]?.id || "";
    });
  }

  function addProject(brandId: string) {
    setDraft((current) => ({
      ...current,
      brands: current.brands.map((brand) => {
        if (brand.id !== brandId) return brand;
        const taken = new Set(brand.projects.map((project) => project.id));
        const id = uniqueId(`${brand.id}-project`, taken);
        return { ...brand, projects: [...brand.projects, emptyProject(id)] };
      })
    }));
  }

  function removeProject(brandId: string, projectId: string) {
    if (!confirm("Remove this project from the config?")) return;
    setDraft((current) => ({
      ...current,
      brands: current.brands.map((brand) =>
        brand.id === brandId
          ? { ...brand, projects: brand.projects.filter((project) => project.id !== projectId) }
          : brand
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
    setDraft(structuredClone(config));
    setReviewer(profile.reviewer || "");
    setError("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const savedConfig = await window.sentinel.saveConfig(draft);
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
            onSelectBrand={setActiveBrandId}
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

        {tab === "profile" && (
          <ProfileTab reviewer={reviewer} onReviewerChange={setReviewer} />
        )}
      </div>
    </main>
  );
}

type BrandsTabProps = {
  brands: Brand[];
  activeBrand: Brand | undefined;
  onSelectBrand: (id: string) => void;
  onAddBrand: () => void;
  onRemoveBrand: (id: string) => void;
  onUpdateBrand: (id: string, patch: Partial<Brand>) => void;
  onAddProject: (brandId: string) => void;
  onRemoveProject: (brandId: string, projectId: string) => void;
  onUpdateProject: (brandId: string, projectId: string, patch: Partial<Project>) => void;
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
            key={brand.id}
            className={`brand-list-item ${activeBrand?.id === brand.id ? "active" : ""}`}
            onClick={() => onSelectBrand(brand.id)}
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
            onRemove={() => onRemoveBrand(activeBrand.id)}
            onUpdate={(patch) => onUpdateBrand(activeBrand.id, patch)}
            onAddProject={() => onAddProject(activeBrand.id)}
            onRemoveProject={(projectId) => onRemoveProject(activeBrand.id, projectId)}
            onUpdateProject={(projectId, patch) => onUpdateProject(activeBrand.id, projectId, patch)}
          />
        )}
      </div>
    </div>
  );
}

type BrandEditorProps = {
  brand: Brand;
  onRemove: () => void;
  onUpdate: (patch: Partial<Brand>) => void;
  onAddProject: () => void;
  onRemoveProject: (projectId: string) => void;
  onUpdateProject: (projectId: string, patch: Partial<Project>) => void;
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
        <div className="grid two">
          <Field label="Brand name">
            <input
              value={brand.name}
              onChange={(event) => onUpdate({ name: event.target.value })}
              placeholder="Acme"
            />
          </Field>
          <Field label="Brand ID" hint="Used in folder paths and webview partition names. Slug-style.">
            <input
              value={brand.id}
              onChange={(event) => onUpdate({ id: slug(event.target.value) })}
              placeholder="acme"
            />
          </Field>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Projects</h3>
          <button className="settings-button" onClick={onAddProject}>
            <Plus size={14} />
            Add project
          </button>
        </div>
        {brand.projects.length === 0 && (
          <p className="muted">No projects in this brand yet.</p>
        )}
        {brand.projects.map((project) => (
          <ProjectEditor
            key={project.id}
            project={project}
            onRemove={() => onRemoveProject(project.id)}
            onUpdate={(patch) => onUpdateProject(project.id, patch)}
          />
        ))}
      </div>
    </div>
  );
}

type ProjectEditorProps = {
  project: Project;
  onRemove: () => void;
  onUpdate: (patch: Partial<Project>) => void;
};

function ProjectEditor({ project, onRemove, onUpdate }: ProjectEditorProps) {
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
        <Field label="Project name">
          <input
            value={project.name}
            onChange={(event) => onUpdate({ name: event.target.value })}
            placeholder="Marketing site"
          />
        </Field>
        <Field label="Project ID" hint="Slug-style; used in data paths.">
          <input
            value={project.id}
            onChange={(event) => onUpdate({ id: slug(event.target.value) })}
            placeholder="marketing"
          />
        </Field>
      </div>

      <div className="grid two">
        <Field label="Root URL">
          <input
            value={project.rootUrl}
            onChange={(event) => onUpdate({ rootUrl: event.target.value })}
            placeholder="https://example.com"
          />
        </Field>
        <Field label="GitHub repo" hint="owner/repo — where issues are filed.">
          <input
            value={project.githubRepo}
            onChange={(event) => onUpdate({ githubRepo: event.target.value })}
            placeholder="owner/repo"
          />
        </Field>
      </div>

      <div className="grid two">
        <Field label="Discovery mode">
          <select
            value={project.mode}
            onChange={(event) => onUpdate({ mode: event.target.value as Project["mode"] })}
          >
            <option value="sitemap">sitemap — only sitemaps</option>
            <option value="discover">discover — only crawl seed URLs</option>
            <option value="hybrid">hybrid — sitemaps + discovery</option>
          </select>
        </Field>
        <Field label="Webview partition" hint="persist:NAME — share login state across projects of the same brand.">
          <input
            value={project.webviewPartition || ""}
            onChange={(event) => onUpdate({ webviewPartition: event.target.value })}
            placeholder={`persist:${project.id || "brand"}`}
          />
        </Field>
      </div>

      <Field label="Sitemap URLs" hint="One URL per line.">
        <textarea
          value={arrayToMultiline(project.sitemaps)}
          onChange={(event) => onUpdate({ sitemaps: multilineToArray(event.target.value) })}
          placeholder="https://example.com/sitemap.xml"
          rows={3}
        />
      </Field>

      <Field label="Seed URLs" hint="One URL per line. Used for discovery mode.">
        <textarea
          value={arrayToMultiline(project.seedUrls)}
          onChange={(event) => onUpdate({ seedUrls: multilineToArray(event.target.value) })}
          placeholder="https://example.com/start"
          rows={3}
        />
      </Field>

      <div className="grid two">
        <Field label="Issue labels" hint="Comma separated — applied to filed GitHub issues.">
          <input
            value={arrayToCsv(project.labels)}
            onChange={(event) => onUpdate({ labels: csvToArray(event.target.value) })}
            placeholder="qa, website"
          />
        </Field>
        <Field label="Allowed domains" hint="Comma separated. Empty = only the rootUrl host.">
          <input
            value={arrayToCsv(project.allowedDomains)}
            onChange={(event) => onUpdate({ allowedDomains: csvToArray(event.target.value) })}
            placeholder="cdn.example.com"
          />
        </Field>
      </div>

      <Field label="Ignore URL patterns" hint="One per line. Substring match against discovered URLs.">
        <textarea
          value={arrayToMultiline(project.ignorePatterns)}
          onChange={(event) => onUpdate({ ignorePatterns: multilineToArray(event.target.value) })}
          placeholder="/wp-admin"
          rows={2}
        />
      </Field>

      <div className="grid two">
        <Field label="Query string mode" hint="Override the global discovery setting for this project.">
          <select
            value={project.queryStringMode || ""}
            onChange={(event) =>
              onUpdate({ queryStringMode: (event.target.value || undefined) as Project["queryStringMode"] })
            }
          >
            <option value="">Use global default</option>
            <option value="strip-tracking">strip-tracking</option>
            <option value="strip-all">strip-all</option>
            <option value="allowlist">allowlist</option>
            <option value="preserve">preserve</option>
          </select>
        </Field>
        <Field label="Allowed query params" hint="Comma separated. Used when query string mode = allowlist.">
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
    </div>
  );
}

type GlobalTabProps = {
  config: AppConfig;
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
        <div className="grid two">
          <Field label="Branch strategy">
            <select
              value={sync.branchStrategy || "per-user"}
              onChange={(event) =>
                onSyncChange({ branchStrategy: event.target.value as NonNullable<AppConfig["sync"]>["branchStrategy"] })
              }
            >
              <option value="per-user">per-user — one branch per reviewer</option>
              <option value="per-project">per-project — one branch shared across reviewers</option>
              <option value="current-branch">current-branch — never switch</option>
            </select>
          </Field>
          <Field label="Branch prefix">
            <input
              value={sync.branchPrefix || "qa"}
              onChange={(event) => onSyncChange({ branchPrefix: event.target.value })}
              placeholder="qa"
            />
          </Field>
        </div>
        <div className="grid two">
          <Field label="Inactivity sync (seconds)" hint="Auto-sync if no activity for this long. Min 30.">
            <input
              type="number"
              min={30}
              value={sync.inactivitySeconds ?? 600}
              onChange={(event) => onSyncChange({ inactivitySeconds: Number(event.target.value) })}
            />
          </Field>
          <Field label="Pages per batch" hint="Reserved for future batched-sync UX.">
            <input
              type="number"
              min={1}
              value={sync.batchPageCount ?? 10}
              onChange={(event) => onSyncChange({ batchPageCount: Number(event.target.value) })}
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
      </section>

      <section className="card">
        <h3>GitHub CLI</h3>
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
      </section>

      <section className="card">
        <h3>Screenshots</h3>
        <Field label="Storage">
          <select
            value={screenshots.storage || "repo"}
            onChange={(event) =>
              onScreenshotsChange({
                storage: event.target.value as NonNullable<AppConfig["screenshots"]>["storage"]
              })
            }
          >
            <option value="repo">repo — saved under screenshots/ in this checkout</option>
            <option value="external">external — kept outside the repo</option>
          </select>
        </Field>
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
      </section>

      <section className="card">
        <h3>Discovery</h3>
        <Field label="Default query string mode">
          <select
            value={discovery.queryStringMode || "strip-tracking"}
            onChange={(event) =>
              onDiscoveryChange({
                queryStringMode: event.target.value as NonNullable<AppConfig["discovery"]>["queryStringMode"]
              })
            }
          >
            <option value="strip-tracking">strip-tracking — drop common ad/tracking params</option>
            <option value="strip-all">strip-all — drop every query parameter</option>
            <option value="allowlist">allowlist — keep only project allowedQueryParams</option>
            <option value="preserve">preserve — keep query strings as-is</option>
          </select>
        </Field>
        <Field label="Tracking parameters" hint="Comma separated. Wildcards like utm_* are supported.">
          <input
            value={arrayToCsv(discovery.trackingParams)}
            onChange={(event) => onDiscoveryChange({ trackingParams: csvToArray(event.target.value) })}
            placeholder="utm_*, fbclid, gclid"
          />
        </Field>
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-field">
      <span className="settings-field-label">{label}</span>
      {children}
      {hint && <span className="settings-field-hint">{hint}</span>}
    </div>
  );
}
