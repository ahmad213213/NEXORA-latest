const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexora', {
  chooseExecutable: () => ipcRenderer.invoke('game:choose-executable'),
  searchGames: (query) => ipcRenderer.invoke('game:search', query),
  addGame: (payload) => ipcRenderer.invoke('game:add', payload),
  getLibrary: () => ipcRenderer.invoke('library:list'),
  onImportProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('game:import-progress', handler);
    return () => ipcRenderer.removeListener('game:import-progress', handler);
  }
});