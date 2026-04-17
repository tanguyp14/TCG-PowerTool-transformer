const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  auth: {
    getUser:  ()             => ipcRenderer.invoke("auth:getUser"),
    login:    (email, pass)  => ipcRenderer.invoke("auth:login", email, pass),
    register: (email, pass)  => ipcRenderer.invoke("auth:register", email, pass),
    logout:   ()             => ipcRenderer.invoke("auth:logout"),
  },
  getAll:     ()             => ipcRenderer.invoke("db:getAll"),
  saveGame:   (name, sets)   => ipcRenderer.invoke("db:saveGame", name, sets),
  deleteGame: (name)         => ipcRenderer.invoke("db:deleteGame", name),
  renameGame: (old_, new_)   => ipcRenderer.invoke("db:renameGame", old_, new_),
  importJSON: ()             => ipcRenderer.invoke("db:importJSON"),
  getDbPath:  ()             => ipcRenderer.invoke("db:getPath"),
});
