const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rojoMultiplex", {
  selectProject: () => ipcRenderer.invoke("select-project"),
  installPlugin: () => ipcRenderer.invoke("install-plugin"),
});
