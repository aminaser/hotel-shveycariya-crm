const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getAppPath: () => ipcRenderer.invoke("get-app-path"),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  isElectron: true,
});
