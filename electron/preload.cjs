const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppPath: () => ipcRenderer.invoke("get-app-path"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  relaunchApp: () => ipcRenderer.invoke("relaunch-app"),
  isElectron: true,
});
