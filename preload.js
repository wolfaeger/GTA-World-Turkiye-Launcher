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
  openExternal: (url, opts) => ipcRenderer.send("open-external", url, opts),
  getSettings: () => ipcRenderer.invoke("settings-get"),
  setSettings: (patch) => ipcRenderer.invoke("settings-set", patch),
  resetSettings: () => ipcRenderer.invoke("settings-reset"),
  openLog: () => ipcRenderer.invoke("open-log"),
  onSettingsChanged: (cb) => ipcRenderer.on("settings-changed", (_e, s) => cb(s)),
  onGameState: (cb) => ipcRenderer.on("game-state", (_e, on) => cb(!!on)),
  openFivemFolder: (name) => ipcRenderer.invoke("fivem-open-folder", name),
  clearFivemCache: () => ipcRenderer.invoke("fivem-clear-cache")
});
