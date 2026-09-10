// 外壳界面（浏览器 chrome）preload —— 暴露完整桥接 API
const { contextBridge, ipcRenderer } = require('electron')

const on = (channel) => (cb) => {
  const listener = (_event, payload) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('dshBrowser', {
  env: {
    ready: () => ipcRenderer.invoke('shell:ready')
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('win:toggleMaximize'),
    close: () => ipcRenderer.invoke('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
    onState: on('evt:win')
  },
  tabs: {
    create: (url) => ipcRenderer.invoke('tabs:new', url),
    navigate: (id, url) => ipcRenderer.invoke('tabs:navigate', { id, url }),
    notifyActive: (id) => ipcRenderer.send('tabs:activated', id)
  },
  server: {
    status: () => ipcRenderer.invoke('server:status'),
    start: () => ipcRenderer.invoke('server:start'),
    stop: () => ipcRenderer.invoke('server:stop'),
    restart: () => ipcRenderer.invoke('server:restart'),
    recheck: () => ipcRenderer.invoke('server:recheck'),
    logs: () => ipcRenderer.invoke('server:logs'),
    clearLogs: () => ipcRenderer.invoke('server:logs:clear'),
    onStatus: on('evt:server'),
    onLog: on('evt:server-log')
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    reset: () => ipcRenderer.invoke('settings:reset')
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    toggleAlwaysOnTop: () => ipcRenderer.invoke('app:toggleAlwaysOnTop'),
    quit: () => ipcRenderer.invoke('app:quit'),
    info: () => ipcRenderer.invoke('app:info'),
    shellDevTools: () => ipcRenderer.invoke('devtools:shell')
  },
  events: {
    onToast: on('evt:toast'),
    onNewTab: on('evt:new-tab'),
    onCloseActiveTab: on('evt:close-active-tab'),
    onFocusAddress: on('evt:focus-address'),
    onOpenSettings: on('evt:open-settings'),
    onOpenLogs: on('evt:open-logs'),
    onOpenAbout: on('evt:open-about'),
    onNav: on('evt:nav'),
    onTheme: on('evt:theme')
  }
})
