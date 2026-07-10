const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("workspace", {
  getState: () => ipcRenderer.invoke("workspace:get-state"),
  setPaneCount: (count) => ipcRenderer.invoke("workspace:set-pane-count", count),
  setLayoutMode: (mode) => ipcRenderer.invoke("workspace:set-layout-mode", mode),
  arrange: () => ipcRenderer.invoke("workspace:arrange"),
  setLayoutLocked: (locked) => ipcRenderer.invoke("workspace:set-layout-locked", locked),
  showAll: () => ipcRenderer.invoke("workspace:show-all"),
  hideAll: () => ipcRenderer.invoke("workspace:hide-all"),
  focusPane: (id) => ipcRenderer.invoke("workspace:focus-pane", id),
  togglePane: (id) => ipcRenderer.invoke("workspace:toggle-pane", id),
  onState: (callback) => {
    ipcRenderer.on("workspace:state", (_event, state) => callback(state));
  }
});
