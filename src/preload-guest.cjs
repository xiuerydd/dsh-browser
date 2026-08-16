// 标签页 guest preload —— 仅在应用内置通知页（dshb://）暴露最小 API。
// 在 DSH 页面或外部站点中不暴露任何桥接，保证页面环境干净。
const { contextBridge, ipcRenderer } = require('electron')

if (typeof location !== 'undefined' && location.protocol === 'dshb:') {
  const on = (channel) => (cb) => {
    const listener = (_event, payload) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }

  contextBridge.exposeInMainWorld('dshBrowser', {
    notice: true,
    status: () => ipcRenderer.invoke('server:status'),
    startServer: () => ipcRenderer.invoke('server:start'),
    logs: () => ipcRenderer.invoke('server:logs'),
    retry: () => ipcRenderer.invoke('notice:retry'),
    home: () => ipcRenderer.invoke('notice:home'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    onStatus: on('evt:server'),
    onLog: on('evt:server-log')
  })
}
