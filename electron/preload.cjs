// Preload script — runs in an isolated context with access to Node.
// Exposes a minimal, safe API to the renderer via contextBridge.
// The renderer calls window.studio.db.* and never touches Node directly.


const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  db: {
    all: (sql, params = []) => ipcRenderer.invoke('db:all', sql, params),
    get: (sql, params = []) => ipcRenderer.invoke('db:get', sql, params),
    run: (sql, params = []) => ipcRenderer.invoke('db:run', sql, params),
    transaction: (statements = []) =>
  ipcRenderer.invoke('db:transaction', statements),
    reset: () => ipcRenderer.invoke('db:reset'),
  },
  util: {
    uuid: () => ipcRenderer.invoke('util:uuid'),
  },
  file: {
  pick: () => ipcRenderer.invoke('file:pick'),
}
});
