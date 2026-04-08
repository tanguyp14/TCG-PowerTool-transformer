const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Database
  getAll: () => ipcRenderer.invoke("db:getAll"),
  saveGame: (name, sets) => ipcRenderer.invoke("db:saveGame", name, sets),
  deleteGame: (name) => ipcRenderer.invoke("db:deleteGame", name),
  renameGame: (oldName, newName) => ipcRenderer.invoke("db:renameGame", oldName, newName),
  importJSON: () => ipcRenderer.invoke("db:importJSON"),
  getDbPath: () => ipcRenderer.invoke("db:getPath"),
});
