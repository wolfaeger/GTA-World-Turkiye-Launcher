const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("launcher", {
  minimize: () => ipcRenderer.send("minimize"),
  close: () => ipcRenderer.send("close"),
  ping: (url) => ipcRenderer.invoke("ping", url),
  fivemInstalled: () => ipcRenderer.invoke("fivem-installed"),
  checkUpdate: () => ipcRenderer.invoke("update-check"),
  applyUpdate: () => ipcRenderer.invoke("update-apply"),
  version: () => ipcRenderer.invoke("app-version"),
  onConnectReset: (cb) => ipcRenderer.on("connect-reset", () => cb()),
  openExternal: (url, opts) => ipcRenderer.send("open-external", url, opts)
});
