const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sentinel", {
  bootstrap: () => ipcRenderer.invoke("app:bootstrap"),
  refreshProject: (payload) => ipcRenderer.invoke("project:refresh", payload),
  savePageAction: (payload) => ipcRenderer.invoke("page:action", payload),
  reportIssue: (payload) => ipcRenderer.invoke("issue:report", payload),
  saveDiscoveredUrls: (payload) => ipcRenderer.invoke("discovery:urls", payload),
  saveRecordedAction: (payload) => ipcRenderer.invoke("recording:action", payload),
  syncNow: () => ipcRenderer.invoke("git:sync"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url)
});
