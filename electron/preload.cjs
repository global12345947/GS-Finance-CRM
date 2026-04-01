const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  saveServerUrl: (url) => ipcRenderer.invoke("save-server-url", url),
  testConnection: (url) => ipcRenderer.invoke("test-connection", url),
  getConfig: () => ipcRenderer.invoke("get-config"),
  resetServer: () => ipcRenderer.invoke("reset-server"),
});
