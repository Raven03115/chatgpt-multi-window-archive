const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chatgptMulti", {
  getState: () => ipcRenderer.invoke("get-state"),

  setLayout: (count) => ipcRenderer.invoke("set-layout", count),

  selectPane: (index) => ipcRenderer.invoke("select-pane", index),

  reloadAll: () => ipcRenderer.invoke("reload-all"),

  reloadActive: () => ipcRenderer.invoke("reload-active"),

  newChatActive: () => ipcRenderer.invoke("new-chat-active"),

  saveCurrentChat: () => ipcRenderer.invoke("save-current-chat"),

  loadSavedChat: (id) => ipcRenderer.invoke("load-saved-chat", id),

  deleteSavedChat: (id) => ipcRenderer.invoke("delete-saved-chat", id),

  onStateUpdated: (callback) => {
    ipcRenderer.on("state-updated", (_event, state) => {
      callback(state);
    });
  }
});