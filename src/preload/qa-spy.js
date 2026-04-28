const { ipcRenderer } = require("electron");

const sentUrls = new Set();

function normalizeHref(raw) {
  try {
    const url = new URL(raw, window.location.href);
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function sendDiscoveredUrls() {
  const urls = Array.from(document.querySelectorAll("a[href]"))
    .map((link) => normalizeHref(link.getAttribute("href")))
    .filter(Boolean);

  const fresh = [];
  for (const url of urls) {
    if (!sentUrls.has(url)) {
      sentUrls.add(url);
      fresh.push(url);
    }
  }

  if (fresh.length > 0) {
    ipcRenderer.sendToHost("discovered-urls", {
      pageUrl: window.location.href,
      urls: fresh
    });
  }
}

function selectorBundle(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  const el = element;
  const testId = el.getAttribute("data-testid") || el.getAttribute("data-qa") || el.getAttribute("data-cy");
  const id = el.id ? `#${CSS.escape(el.id)}` : null;
  const name = el.getAttribute("name");
  const ariaLabel = el.getAttribute("aria-label");
  const role = el.getAttribute("role");
  const text = (el.innerText || el.textContent || "").trim().slice(0, 80);

  let css = null;
  if (testId) {
    css = `[data-testid="${CSS.escape(testId)}"], [data-qa="${CSS.escape(testId)}"], [data-cy="${CSS.escape(testId)}"]`;
  } else if (id) {
    css = id;
  } else if (name) {
    css = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }

  return {
    css,
    testId,
    id: el.id || null,
    name,
    role,
    ariaLabel,
    text,
    tagName: el.tagName.toLowerCase()
  };
}

function recordAction(type, target, extra = {}) {
  const bundle = selectorBundle(target);
  if (!bundle) return;
  ipcRenderer.sendToHost("record-action", {
    type,
    pageUrl: window.location.href,
    timestamp: new Date().toISOString(),
    selectorBundle: bundle,
    ...extra
  });
}

window.addEventListener(
  "click",
  (event) => {
    recordAction("click", event.target);
  },
  true
);

window.addEventListener(
  "change",
  (event) => {
    const target = event.target;
    const type = target && target.tagName ? target.tagName.toLowerCase() : "";
    const sensitive =
      target &&
      (target.type === "password" ||
        target.type === "hidden" ||
        target.type === "email" ||
        target.closest("[data-sentry-block], [data-sensitive]"));

    recordAction("change", target, {
      elementType: type,
      valueStrategy: sensitive ? "redacted-sensitive" : "redacted"
    });
  },
  true
);

window.addEventListener("DOMContentLoaded", () => {
  sendDiscoveredUrls();
  const observer = new MutationObserver(() => {
    window.clearTimeout(window.__sentinelLinkTimer);
    window.__sentinelLinkTimer = window.setTimeout(sendDiscoveredUrls, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});
