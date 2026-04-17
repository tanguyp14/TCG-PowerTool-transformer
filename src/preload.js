const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  auth: {
    getUser:  ()             => ipcRenderer.invoke("auth:getUser"),
    login:    (username, pass) => ipcRenderer.invoke("auth:login", username, pass),
    logout:   ()             => ipcRenderer.invoke("auth:logout"),
  },
  getAll:     ()             => ipcRenderer.invoke("db:getAll"),
  ping:       ()             => ipcRenderer.invoke("db:ping"),
  saveGame:   (name, sets)   => ipcRenderer.invoke("db:saveGame", name, sets),
  deleteGame: (name)         => ipcRenderer.invoke("db:deleteGame", name),
  renameGame: (old_, new_)   => ipcRenderer.invoke("db:renameGame", old_, new_),
  importJSON: ()             => ipcRenderer.invoke("db:importJSON"),
  getDbPath:  ()             => ipcRenderer.invoke("db:getPath"),
});
