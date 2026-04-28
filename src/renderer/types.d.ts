import type * as React from "react";

export {};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        preload?: string;
        partition?: string;
        allowpopups?: boolean;
      };
    }
  }

  interface Window {
    sentinel: {
      bootstrap: () => Promise<Bootstrap>;
      refreshProject: (payload: ProjectPayload) => Promise<ProjectState>;
      savePageAction: (payload: PageActionPayload) => Promise<{ page: QaPage }>;
      reportIssue: (payload: ReportIssuePayload) => Promise<{ issueUrl: string; screenshotPath?: string; page: QaPage }>;
      saveDiscoveredUrls: (payload: DiscoveredPayload) => Promise<{ added: string[] }>;
      saveRecordedAction: (payload: RecordedActionPayload) => Promise<{ saved: boolean }>;
      syncNow: () => Promise<Record<string, unknown>>;
      openExternal: (url: string) => Promise<{ ok: boolean }>;
    };
  }
}

export type AppConfig = {
  schemaVersion: number;
  sync?: {
    enabled?: boolean;
    batchPageCount?: number;
    inactivitySeconds?: number;
    branchStrategy?: string;
    branchPrefix?: string;
  };
  screenshots?: {
    storage?: string;
    commitScreenshots?: boolean;
    deleteAfterIssueCreation?: boolean;
  };
  discovery?: {
    queryStringMode?: string;
    trackingParams?: string[];
  };
  brands: Brand[];
};

export type Brand = {
  id: string;
  name: string;
  projects: Project[];
};

export type Project = {
  id: string;
  name: string;
  rootUrl: string;
  sitemaps?: string[];
  seedUrls?: string[];
  mode: "sitemap" | "discover" | "hybrid";
  githubRepo: string;
  labels?: string[];
  webviewPartition?: string;
  recordActions?: boolean;
};

export type Bootstrap = {
  config: AppConfig;
  gh: {
    available: boolean;
    authenticated: boolean;
    message?: string;
  };
  user: string;
  qaPreloadPath: string;
};

export type QaPage = {
  url: string;
  normalizedUrl: string;
  source: string;
  status: "pending" | "approved" | "issue" | "needs_recheck" | "discovered" | "skipped" | "ignored";
  needsReview: boolean;
  isModified: boolean;
  isNew: boolean;
  sitemapLastmod?: string | null;
  lastInspectedAt?: string | null;
  lastIssueUrl?: string | null;
  lastScreenshotPath?: string | null;
};

export type ProjectPayload = {
  brandId: string;
  projectId: string;
};

export type ProjectState = {
  brand: Brand;
  project: Project;
  pages: QaPage[];
  warnings: string[];
};

export type PageActionPayload = ProjectPayload & {
  url: string;
  status: QaPage["status"];
  source?: string;
  sitemapLastmod?: string | null;
};

export type Evidence = {
  consoleErrors: Array<{ level: string; message: string; source?: string; line?: number; timestamp: string }>;
  networkFailures: Array<{ method?: string; url: string; status?: number; error?: string; timestamp: string }>;
  metadata: Record<string, unknown>;
  recordedSteps: Array<Record<string, any>>;
};

export type ReportIssuePayload = ProjectPayload & {
  pageUrl: string;
  notes: string;
  webContentsId?: number;
  evidence: Evidence;
};

export type DiscoveredPayload = ProjectPayload & {
  pageUrl: string;
  urls: string[];
};

export type RecordedActionPayload = ProjectPayload & {
  pageUrl: string;
  action: Record<string, any>;
};
