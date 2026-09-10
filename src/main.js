import { app, BrowserWindow, ipcMain, Menu, Tray, shell, protocol, nativeImage, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Settings } from './settings.js'
import { ServerManager } from './server.js'
import { classify, normalizeTarget } from './nav-policy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const UI_DIR = path.join(ROOT, 'ui')
const ICON_DIR = path.join(ROOT, 'assets', 'icons')

// 开发调试：支持 --remote-debugging-port=9222
for (const arg of process.argv) {
  const m = arg.match(/^--remote-debugging-port=(\d+)$/)
  if (m) app.commandLine.appendSwitch('remote-debugging-port', m[1])
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'dshb', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  main()
}

function main() {
  let win = null
  let tray = null
  let isQuitting = false
  let tabSeq = 0

  const settings = new Settings()
  const serverMgr = new ServerManager(settings)

  /** webContents.id -> { id, pendingUrl } */
  const guests = new Map()
  /** tab id -> webContents.id（由 did-attach-webview 归属后建立） */
  const guestByTabId = new Map()
  /** 待归属的新标签页 id 队列（shell 创建 webview 后按序 attach） */
  const pendingGuests = []

  const sendToShell = (channel, payload) => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  const navCtx = () => {
    const s = settings.get('server')
    return {
      host: s.host,
      port: s.port,
      extraHosts: s.extraHosts ?? [],
      allowExternalInApp: settings.get('shell.allowExternalInApp')
    }
  }

  /** 剥离 URL 中的 token 参数（持久化/展示时使用，避免陈旧 token 落盘）。 */
  const stripToken = (u) => {
    try { const x = new URL(u); x.searchParams.delete('token'); return x.href } catch { return u }
  }

  /** 给内部地址附加（或刷新）当前 token。 */
  const withToken = (u) => {
    const t = serverMgr.webToken
    if (!t) return u
    try { const x = new URL(u); x.searchParams.set('token', t); return x.href } catch { return u }
  }

  const openExternal = (url) => {
    try {
      const u = new URL(url)
      if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href)
    } catch {
      // ignore malformed urls
    }
  }

  const isNoticeSender = (event) => {
    try {
      return event.sender.getURL().startsWith('dshb:')
    } catch {
      return false
    }
  }

  // ---------- 服务状态广播 ----------
  serverMgr.on('status', (st) => {
    sendToShell('evt:server', st)
    buildMenu()
  })
  serverMgr.on('log', (line) => {
    sendToShell('evt:server-log', line)
  })
  // 服务（重新）启动后 token 更新：所有内部标签页刷新为带新 token 的地址
  serverMgr.on('token', (token) => {
    for (const g of guests.values()) {
      if (g.webContents.isDestroyed()) continue
      const cur = g.webContents.getURL()
      if (cur.startsWith('dshb:')) continue
      const raw = g.pendingUrl || cur
      if (!raw || classify(raw, navCtx()) !== 'internal') continue
      g.pendingUrl = withToken(stripToken(raw))
      g.webContents.loadURL(g.pendingUrl).catch(() => {})
    }
  })

  // ---------- guest 管理 ----------
  function setupGuest(tabId, wc) {
    const g = { id: tabId, webContents: wc, pendingUrl: null }
    guests.set(wc.id, g)
    guestByTabId.set(tabId, wc.id)

    wc.setWindowOpenHandler(({ url }) => {
      const kind = classify(url, navCtx())
      if (kind === 'internal' || kind === 'app') {
        sendToShell('evt:new-tab', normalizeTarget(url, serverMgr.homeUrl))
      } else {
        openExternal(url)
        sendToShell('evt:toast', { kind: 'info', message: '外部链接已在系统浏览器中打开' })
      }
      return { action: 'deny' }
    })

    const guard = (event, url) => {
      if (classify(url, navCtx()) === 'external') {
        event.preventDefault()
        openExternal(url)
        sendToShell('evt:toast', { kind: 'info', message: '外部链接已在系统浏览器中打开' })
      }
    }
    wc.on('will-navigate', guard)
    wc.on('will-redirect', guard)

    const fail = (code, desc, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3) return
      const current = g.webContents.isDestroyed() ? '' : g.webContents.getURL()
      if (current.startsWith('dshb:')) return
      const target = g.pendingUrl || validatedURL || current
      if (!target || target.startsWith('dshb:')) return
      showNotice(g, 'load-fail', { url: target, code, desc })
    }
    wc.on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => fail(code, desc, validatedURL, isMainFrame))
    wc.on('did-fail-provisional-load', (_e, code, desc, validatedURL, isMainFrame) => fail(code, desc, validatedURL, isMainFrame))

    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return
      const current = g.webContents.isDestroyed() ? '' : g.webContents.getURL()
      showNotice(g, 'crashed', { url: g.pendingUrl || current, desc: details.reason })
    })

    wc.on('dom-ready', () => void pollTheme())
    wc.on('did-finish-load', () => void pollTheme())

    wc.on('destroyed', () => {
      guests.delete(wc.id)
      for (const [tid, wid] of guestByTabId) {
        if (wid === wc.id) guestByTabId.delete(tid)
      }
      debouncedSaveTabs()
    })
  }

  function showNotice(g, kind, extra = {}) {
    if (!g.webContents || g.webContents.isDestroyed()) return
    const intended = extra.url || g.pendingUrl || ''
    if (intended && !intended.startsWith('dshb:')) g.pendingUrl = intended
    const q = new URLSearchParams({ kind })
    if (intended) q.set('url', intended)
    if (extra.code !== undefined) q.set('code', String(extra.code))
    if (extra.desc) q.set('desc', String(extra.desc))
    q.set('port', String(settings.get('server.port')))
    g.webContents.loadURL('dshb://notice/?' + q.toString()).catch(() => {})
  }

  function guestFromEvent(event, tabId) {
    if (tabId) return guests.get(guestByTabId.get(tabId))
    const g = guests.get(event.sender.id)
    return g ?? null
  }

  // ---------- 主题同步 ----------
  let activeTabId = null
  let lastTheme = null
  ipcMain.on('tabs:activated', (_e, id) => {
    activeTabId = id
    void pollTheme()
  })

  const THEME_PROBE = `(() => {
    try {
      const cs = getComputedStyle(document.documentElement).colorScheme
      if (cs === 'dark' || cs === 'light') return cs
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } catch { return null }
  })()`

  function applyTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') return
    if (theme === lastTheme) return
    lastTheme = theme
    if (settings.get('shell.resolvedTheme') !== theme) settings.set({ shell: { resolvedTheme: theme } })
    sendToShell('evt:theme', { theme })
    if (win && !win.isDestroyed()) win.setBackgroundColor(theme === 'dark' ? '#0d0e12' : '#f2f4f8')
  }

  async function pollTheme() {
    const mode = settings.get('shell.theme')
    if (mode !== 'follow') {
      applyTheme(mode === 'light' ? 'light' : 'dark')
      return
    }
    const wcId = guestByTabId.get(activeTabId)
    const g = wcId ? guests.get(wcId) : null
    if (!g || g.webContents.isDestroyed()) return
    const cur = g.webContents.getURL()
    if (classify(cur, navCtx()) !== 'internal') return
    try {
      let t = await g.webContents.executeJavaScript(THEME_PROBE, true)
      if (t !== 'light' && t !== 'dark') t = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
      applyTheme(t)
    } catch {
      // 页面加载中：退回到系统主题，等页面就绪事件再校正
      applyTheme(nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    }
  }

  // ---------- 标签页持久化 ----------
  let saveTabsTimer = null
  function debouncedSaveTabs() {
    clearTimeout(saveTabsTimer)
    saveTabsTimer = setTimeout(saveTabs, 800)
  }
  function saveTabs() {
    const urls = []
    for (const g of guests.values()) {
      if (g.webContents.isDestroyed()) continue
      const u = g.pendingUrl || g.webContents.getURL()
      if (u && classify(u, navCtx()) === 'internal') urls.push(stripToken(u))
    }
    settings.set({ lastTabs: urls })
  }

  // ---------- 窗口 ----------
  function createWindow() {
    const saved = settings.get('window.bounds')
    const winOpts = {
      width: 1280,
      height: 820,
      minWidth: 960,
      minHeight: 620,
      show: false,
      frame: false,
      backgroundColor: settings.get('shell.resolvedTheme') === 'light' ? '#f2f4f8' : '#0d0e12',
      icon: path.join(ICON_DIR, 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload-shell.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        spellcheck: false
      }
    }
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.width)) {
      Object.assign(winOpts, { x: saved.x, y: saved.y, width: saved.width, height: saved.height })
    }
    win = new BrowserWindow(winOpts)
    if (settings.get('shell.alwaysOnTop')) win.setAlwaysOnTop(true, 'floating')
    if (settings.get('window.maximized')) win.maximize()

    win.loadFile(path.join(UI_DIR, 'shell.html'))

    win.once('ready-to-show', () => win.show())

    const saveBounds = () => {
      if (!win || win.isDestroyed()) return
      const maximized = win.isMaximized()
      const bounds = maximized ? settings.get('window.bounds') : win.getNormalBounds()
      settings.set({ window: { bounds, maximized } })
    }
    const debouncedBounds = debounce(saveBounds, 500)
    win.on('resize', debouncedBounds)
    win.on('move', debouncedBounds)
    win.on('maximize', debouncedBounds)
    win.on('unmaximize', debouncedBounds)

    win.on('maximize', () => sendToShell('evt:win', winState()))
    win.on('unmaximize', () => sendToShell('evt:win', winState()))
    win.on('enter-full-screen', () => sendToShell('evt:win', winState()))
    win.on('leave-full-screen', () => sendToShell('evt:win', winState()))

    win.on('close', (e) => {
      if (settings.get('shell.closeToTray') && !isQuitting) {
        e.preventDefault()
        win.hide()
      }
    })

    win.webContents.on('did-attach-webview', (_e, wc) => {
      const tabId = pendingGuests.shift()
      if (tabId !== undefined) setupGuest(tabId, wc)
    })
  }

  function winState() {
    return {
      maximized: win?.isMaximized() ?? false,
      fullscreen: win?.isFullScreen() ?? false,
      alwaysOnTop: win?.isAlwaysOnTop() ?? false
    }
  }

  const showWin = () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  // ---------- 托盘 ----------
  function createTray() {
    const iconPath = path.join(ICON_DIR, 'tray.png')
    if (!fs.existsSync(iconPath)) return
    const img = nativeImage.createFromPath(iconPath)
    tray = new Tray(img)
    tray.setToolTip('DeepSeek Harness Browser')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示窗口', click: showWin },
      { label: '新建标签页', click: () => sendToShell('evt:new-tab', null) },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; app.quit() } }
    ]))
    tray.on('click', showWin)
    tray.on('double-click', showWin)
  }

  // ---------- 应用菜单 ----------
  let menu = null
  function buildMenu() {
    const st = serverMgr.status()
    const stateLabel = {
      checking: '检测中…',
      online: '已连接',
      starting: '启动中…',
      stopped: '未连接',
      error: '启动失败'
    }[st.state] ?? st.state

    const template = [
      {
        label: '标签页',
        submenu: [
          { label: '新建标签页', accelerator: 'CmdOrCtrl+T', click: () => sendToShell('evt:new-tab', null) },
          { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: () => sendToShell('evt:close-active-tab', null) },
          { type: 'separator' },
          { label: '后退', accelerator: 'Alt+Left', click: () => sendToShell('evt:nav', 'back') },
          { label: '前进', accelerator: 'Alt+Right', click: () => sendToShell('evt:nav', 'forward') },
          { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => sendToShell('evt:nav', 'reload') },
          { label: '强制重新加载', accelerator: 'CmdOrCtrl+Shift+R', click: () => sendToShell('evt:nav', 'force-reload') },
          { label: '主页', accelerator: 'Alt+Home', click: () => sendToShell('evt:nav', 'home') },
          { type: 'separator' },
          { label: '转到地址栏', accelerator: 'CmdOrCtrl+L', click: () => sendToShell('evt:focus-address', null) }
        ]
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' }
        ]
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '重新加载页面' },
          { role: 'forceReload', label: '强制重新加载页面' },
          { role: 'toggleDevTools', label: '开发者工具（页面）' },
          { label: '开发者工具（界面）', accelerator: 'CmdOrCtrl+Shift+F12', click: () => win?.webContents.openDevTools({ mode: 'detach' }) },
          { type: 'separator' },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' },
          {
            label: '窗口置顶',
            type: 'checkbox',
            checked: settings.get('shell.alwaysOnTop'),
            click: (item) => toggleAlwaysOnTop(item.checked)
          }
        ]
      },
      {
        label: '服务器',
        submenu: [
          { label: `状态：${stateLabel}（${st.url}）`, enabled: false },
          { type: 'separator' },
          { label: '重新检测', click: () => void serverMgr.recheck() },
          { label: '启动服务', enabled: st.state !== 'online' && st.state !== 'starting', click: () => void serverMgr.start({ force: true }) },
          { label: '重启服务', enabled: st.ownsServer, click: () => void serverMgr.restart() },
          { label: '停止服务', enabled: st.ownsServer && (st.state === 'online' || st.state === 'starting'), click: () => void serverMgr.stop() },
          { type: 'separator' },
          { label: '查看日志', click: () => sendToShell('evt:open-logs', null) },
          { label: '在系统浏览器中打开', click: () => openExternal(st.homeUrl) }
        ]
      },
      {
        label: '窗口',
        submenu: [
          { role: 'minimize', label: '最小化' },
          { role: 'close', label: '关闭窗口' }
        ]
      },
      {
        label: '帮助',
        submenu: [
          { label: '设置', accelerator: 'CmdOrCtrl+,', click: () => sendToShell('evt:open-settings', null) },
          { label: '关于 DeepSeek Harness Browser', click: () => sendToShell('evt:open-about', null) },
          { type: 'separator' },
          { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() }
        ]
      }
    ]
    menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
  }

  function toggleAlwaysOnTop(value) {
    const next = typeof value === 'boolean' ? value : !win?.isAlwaysOnTop()
    if (win && !win.isDestroyed()) win.setAlwaysOnTop(next, 'floating')
    settings.set({ shell: { alwaysOnTop: next } })
    sendToShell('evt:win', winState())
    buildMenu()
  }

  // ---------- IPC ----------
  ipcMain.handle('shell:ready', () => ({
    home: serverMgr.homeUrl,
    theme: lastTheme
      ?? settings.get('shell.resolvedTheme')
      ?? (settings.get('shell.theme') === 'light' ? 'light' : 'dark'),
    guestPreload: pathToFileURL(path.join(__dirname, 'preload-guest.cjs')).href,
    initialTabs: initialTabs(),
    serverStatus: serverMgr.status(),
    dshCommand: serverMgr.commandPath
  }))

  function initialTabs() {
    if (settings.get('shell.restoreTabs')) {
      const last = settings.get('lastTabs') ?? []
      const usable = last.map(stripToken).filter((u) => classify(u, navCtx()) === 'internal')
      if (usable.length) return usable
    }
    return [serverMgr.homeUrl]
  }

  ipcMain.handle('win:minimize', () => win?.minimize())
  ipcMain.handle('win:toggleMaximize', () => {
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('win:close', () => win?.close())
  ipcMain.handle('win:isMaximized', () => win?.isMaximized() ?? false)

  ipcMain.handle('tabs:new', (_e, rawUrl) => {
    const url = normalizeTarget(rawUrl || serverMgr.homeUrl, serverMgr.homeUrl) || serverMgr.homeUrl
    const kind = classify(url, navCtx())
    if (kind === 'external') {
      openExternal(url)
      sendToShell('evt:toast', { kind: 'info', message: '外部链接已在系统浏览器中打开' })
      return { id: null, url: null, external: true }
    }
    const id = 'tab-' + (++tabSeq)
    pendingGuests.push(id)
    return { id, url }
  })

  ipcMain.handle('tabs:navigate', (event, payload) => {
    const g = guestFromEvent(event, payload?.id)
    if (!g) return { action: 'none' }
    const base = g.pendingUrl || g.webContents.getURL() || serverMgr.homeUrl
    const url = normalizeTarget(payload?.url, base)
    if (!url) return { action: 'none' }
    const kind = classify(url, navCtx())
    if (kind === 'external') {
      openExternal(url)
      sendToShell('evt:toast', { kind: 'info', message: '外部链接已在系统浏览器中打开' })
      return { action: 'external', url }
    }
    g.pendingUrl = url
    g.webContents.loadURL(url).catch(() => {})
    return { action: 'internal', url }
  })

  ipcMain.handle('server:status', () => serverMgr.status())
  ipcMain.handle('server:start', () => serverMgr.start({ force: true }))
  ipcMain.handle('server:stop', () => serverMgr.stop())
  ipcMain.handle('server:restart', () => serverMgr.restart())
  ipcMain.handle('server:recheck', () => serverMgr.recheck())
  ipcMain.handle('server:logs', () => serverMgr.logs)
  ipcMain.handle('server:logs:clear', () => serverMgr.clearLogs())

  ipcMain.handle('settings:get', () => settings.data)
  ipcMain.handle('settings:set', (_e, patch) => {
    const before = settings.get('server')
    settings.set(patch ?? {})
    const after = settings.get('server')
    const serverChanged = ['host', 'port', 'command', 'workspaceDir', 'extraHosts'].some(
      (k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])
    )
    if (patch?.server && serverChanged) void serverMgr.reconfigure()
    if (patch?.shell?.alwaysOnTop !== undefined) {
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!patch.shell.alwaysOnTop, 'floating')
    }
    if (patch?.shell?.theme !== undefined) void pollTheme()
    buildMenu()
    return settings.data
  })
  ipcMain.handle('settings:reset', () => {
    settings.reset()
    void serverMgr.reconfigure()
    return settings.data
  })

  ipcMain.handle('app:openExternal', (_e, url) => {
    openExternal(url)
    return true
  })
  ipcMain.handle('app:toggleAlwaysOnTop', () => {
    toggleAlwaysOnTop()
    return settings.get('shell.alwaysOnTop')
  })
  ipcMain.handle('app:quit', () => {
    isQuitting = true
    app.quit()
  })
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    homeUrl: serverMgr.homeUrl,
    dshCommand: serverMgr.commandPath,
    userData: app.getPath('userData')
  }))
  ipcMain.handle('devtools:shell', () => win?.webContents.openDevTools({ mode: 'detach' }))

  // 通知页动作（仅允许来自 dshb:// 页面）
  ipcMain.handle('notice:retry', (event) => {
    if (!isNoticeSender(event)) return false
    const g = guests.get(event.sender.id)
    if (!g) return false
    const raw = g.pendingUrl || serverMgr.homeUrl
    g.webContents.loadURL(withToken(stripToken(raw))).catch(() => {})
    return true
  })
  ipcMain.handle('notice:home', (event) => {
    if (!isNoticeSender(event)) return false
    const g = guests.get(event.sender.id)
    if (!g) return false
    g.pendingUrl = serverMgr.homeUrl
    g.webContents.loadURL(serverMgr.homeUrl).catch(() => {})
    return true
  })

  // ---------- 生命周期 ----------
  app.on('second-instance', () => showWin())

  app.on('before-quit', () => {
    isQuitting = true
    if (serverMgr.ownsServer && settings.get('server.stopServerOnQuit')) {
      void serverMgr.stop()
    }
  })

  app.on('window-all-closed', () => {
    if (!settings.get('shell.closeToTray')) app.quit()
  })

  app.on('activate', () => showWin())

  app.whenReady().then(() => {
    app.setAppUserModelId('com.deepseek.dsh-browser')
    protocol.handle('dshb', (req) => {
      const u = new URL(req.url)
      if (u.hostname === 'notice') {
        const html = fs.readFileSync(path.join(UI_DIR, 'notice.html'), 'utf8')
        return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      return new Response('not found', { status: 404 })
    })
    createWindow()
    createTray()
    buildMenu()
    void serverMgr.resolveCommandNow()
    void serverMgr.start()
    setInterval(() => void pollTheme(), 1200)
    void pollTheme()
    serverMgr.on('status', (st) => {
      // 服务恢复在线时，自动刷新正在展示“无法连接”通知页的标签页
      if (st.state === 'online') {
        for (const g of guests.values()) {
          if (g.webContents.isDestroyed()) continue
          const cur = g.webContents.getURL()
          if (cur.startsWith('dshb://notice') && new URL(cur).searchParams.get('kind') === 'load-fail') {
            const target = withToken(stripToken(g.pendingUrl || serverMgr.homeUrl))
            g.webContents.loadURL(target).catch(() => {})
          }
        }
      }
    })
  })
}

function debounce(fn, ms) {
  let t = null
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}
