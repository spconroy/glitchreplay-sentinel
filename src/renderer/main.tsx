import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

function BrowserNotice() {
  return (
    <main className="loading-screen">
      <div style={{ maxWidth: 520, textAlign: "center", padding: 24 }}>
        <h2 style={{ margin: "0 0 8px" }}>Open this in the Electron window</h2>
        <p style={{ margin: 0, opacity: 0.7, lineHeight: 1.5 }}>
          GlitchReplay Sentinel is a desktop app. The Vite dev server at
          127.0.0.1:5173 is meant to be loaded by the Electron shell that{" "}
          <code>npm run dev</code> launches alongside it — not in a regular
          browser. Look for the Electron window that opened with the dev
          server, or run <code>npm start</code> after a build.
        </p>
      </div>
    </main>
  );
}

const hasBridge = typeof window !== "undefined" && Boolean((window as any).sentinel);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{hasBridge ? <App /> : <BrowserNotice />}</React.StrictMode>
);
