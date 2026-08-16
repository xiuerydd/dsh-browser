/* DeepSeek Harness Browser —— 外壳界面逻辑 */
'use strict'

const api = window.dshBrowser
const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => Array.from(document.querySelectorAll(sel))

const state = {
  env: null,
  settings: null,
  server: null,
  tabs: new Map(),   // id -> { id, el, title, favicon, url, pendingUrl, loading }
  order: [],
  activeId: null,
  addressFocused: false,
  logsOpen: false
}

/* ---------------- 工具 ---------------- */
const el = (tag, cls, text) => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

const svgIcon = (inner, viewBox = '0 0 24 24') => {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', viewBox)
  svg.innerHTML = inner
  return svg
}

const ICONS = {
  whale: '<svg class="whale" viewBox="0 0 50 50"><path d="M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z" fill="currentColor" stroke="none"/></svg>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  reload: '<path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7"/>',
  external: '<path d="M10 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4"/><path d="M14 4h6v6"/><path d="M20 4l-9 9"/>',
  check: '<path d="M5 13l4 4L19 7"/>'
}

const toast = (message, kind = 'info') => {
  const box = $('#toasts')
  const t = el('div', 'toast ' + kind, message)
  box.appendChild(t)
  setTimeout(() => t.remove(), 3600)
}

const fmtTime = (ts) => {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

/* ---------------- 标签页 ---------------- */
function activeTab() {
  return state.tabs.get(state.activeId) ?? null
}

function isAppUrl(url) {
  return /^dshb:/i.test(url || '')
}

async function createTab(id, url) {
  const view = el('webview')
  view.setAttribute('src', url)
  view.setAttribute('preload', state.env.guestPreload)
  view.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, spellcheck=no')
  view.classList.add('tabview')

  const tab = { id, el: view, title: 'DeepSeek Harness', favicon: null, url, pendingUrl: url, loading: false, ready: false }
  state.tabs.set(id, tab)
  state.order.push(id)
  $('#views').appendChild(view)

  view.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || 'DeepSeek Harness'
    renderTabs()
  })
  view.addEventListener('page-favicon-updated', (e) => {
    tab.favicon = (e.favicons && e.favicons[0]) || null
    renderTabs()
  })
  view.addEventListener('did-start-loading', () => {
    tab.loading = true
    renderTabs()
    refreshChrome()
  })
  view.addEventListener('did-stop-loading', () => {
    tab.loading = false
    renderTabs()
    refreshChrome()
  })
  view.addEventListener('did-navigate', (e) => {
    tab.url = e.url
    if (!isAppUrl(e.url)) tab.pendingUrl = e.url
    refreshChrome()
  })
  view.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url
    if (!isAppUrl(e.url)) tab.pendingUrl = e.url
    refreshChrome()
  })
  view.addEventListener('dom-ready', () => {
    tab.ready = true
    refreshChrome()
  })
  view.addEventListener('focus', () => activate(id))
  view.addEventListener('context-menu', (e) => e.preventDefault())

  activate(id)
  return tab
}

function activate(id) {
  if (!state.tabs.has(id)) return
  if (state.activeId !== id) {
    state.activeId = id
    for (const [tid, t] of state.tabs) {
      t.el.classList.toggle('active', tid === id)
    }
  }
  api.tabs.notifyActive(id)
  renderTabs()
  refreshChrome()
  const t = state.tabs.get(id)
  t.el.focus()
}

async function closeTab(id) {
  const idx = state.order.indexOf(id)
  const tab = state.tabs.get(id)
  if (!tab) return
  tab.el.remove()
  state.tabs.delete(id)
  state.order.splice(idx, 1)
  if (state.activeId === id) {
    const next = state.order[Math.max(0, idx - 1)]
    if (next) activate(next)
  }
  if (state.order.length === 0) {
    // 始终保持至少一个标签页
    await openNewTab(null)
  }
  renderTabs()
  refreshChrome()
}

async function openNewTab(url) {
  const res = await api.tabs.create(url ?? null)
  if (res && res.id) await createTab(res.id, res.url)
}

async function navigateActive(rawUrl) {
  const t = activeTab()
  if (!t) return
  const res = await api.tabs.navigate(t.id, rawUrl)
  if (!res) return
  if (res.action === 'external') {
    toast('外部链接已在系统浏览器中打开')
  }
}

/* ---------------- 渲染 ---------------- */
function renderTabs() {
  const strip = $('#tabstrip')
  strip.textContent = ''
  for (const id of state.order) {
    const t = state.tabs.get(id)
    if (!t) continue
    const tab = el('div', 'tab' + (id === state.activeId ? ' active' : ''))
    tab.dataset.id = id
    tab.title = t.url || ''

    let fav
    if (isAppUrl(t.url)) {
      fav = el('span', 'fav whale')
      fav.appendChild(svgIcon(ICONS.whale))
    } else if (t.favicon) {
      fav = el('img', 'fav')
      fav.src = t.favicon
    } else {
      fav = el('span', 'fav whale')
      fav.appendChild(svgIcon(ICONS.whale))
    }
    const title = el('span', 'title', t.title || 'DeepSeek Harness')
    const close = el('button', 'tabclose', '')
    close.title = '关闭标签页'
    close.appendChild(svgIcon(ICONS.close))
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(id) })

    tab.appendChild(fav)
    tab.appendChild(title)
    tab.appendChild(close)
    tab.addEventListener('click', () => activate(id))
    tab.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id) })
    tab.addEventListener('contextmenu', (e) => showTabMenu(e, id))
    strip.appendChild(tab)
  }
}

function navState(t) {
  if (!t || !t.ready) return { back: false, fwd: false }
  try {
    return { back: t.el.canGoBack(), fwd: t.el.canGoForward() }
  } catch {
    return { back: false, fwd: false }
  }
}

function refreshChrome() {
  const t = activeTab()
  if (!t) return
  if (!state.addressFocused) $('#address').value = isAppUrl(t.url) ? (t.pendingUrl || t.url) : (t.url || '')
  const ns = navState(t)
  $('#btn-back').disabled = !ns.back
  $('#btn-fwd').disabled = !ns.fwd
  const reloadBtn = $('#btn-reload')
  reloadBtn.classList.toggle('loading', t.loading)
  reloadBtn.disabled = isAppUrl(t.url)
  $('#progress').classList.toggle('active', t.loading)
  renderTabs()
}

function refreshNav() {
  const ns = navState(activeTab())
  $('#btn-back').disabled = !ns.back
  $('#btn-fwd').disabled = !ns.fwd
}

/* ---------------- 主题 ---------------- */
function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light')
}

/* ---------------- 服务器状态 ---------------- */
const SERVER_LABELS = {
  checking: '检测中…',
  online: '已连接',
  starting: '启动中…',
  stopped: '未连接',
  error: '启动失败'
}

function setServer(st) {
  state.server = st
  const dot = $('#chip-dot')
  const label = $('#chip-label')
  dot.className = 'dot ' + st.state
  label.textContent = SERVER_LABELS[st.state] ?? st.state
  $('#serverchip').title = st.url
}

/* ---------------- 下拉菜单 ---------------- */
function hideMenus() {
  $('#chipmenu').classList.add('hidden')
  $('#appmenu').classList.add('hidden')
  $('#tabmenu')?.remove()
  if (menuBackdrop !== null) menuBackdrop.classList.add('hidden')
}

// Webview clicks never reach the shell document, so a full-window backdrop
// swallows the next click anywhere (including inside the page) to dismiss menus.
let menuBackdrop = null
function showMenuBackdrop() {
  if (menuBackdrop === null) {
    menuBackdrop = document.createElement('div')
    menuBackdrop.id = 'menu-backdrop'
    menuBackdrop.addEventListener('click', () => hideMenus())
    document.body.appendChild(menuBackdrop)
  }
  menuBackdrop.classList.remove('hidden')
}

function positionMenu(menu, anchor) {
  const r = anchor.getBoundingClientRect()
  menu.classList.remove('hidden')
  const mw = menu.offsetWidth
  let left = Math.min(r.left, window.innerWidth - mw - 8)
  menu.style.left = Math.max(8, left) + 'px'
  menu.style.top = (r.bottom + 6) + 'px'
}

function menuItem(menu, opts) {
  const item = el('div', 'item')
  if (opts.disabled) item.classList.add('disabled')
  if (opts.label) item.appendChild(el('span', 'label', opts.label))
  if (opts.hint) item.appendChild(el('span', 'hint', opts.hint))
  if (opts.checked) item.appendChild(svgIcon(ICONS.check)).classList.add('check')
  if (!opts.disabled) item.addEventListener('click', () => { hideMenus(); opts.onClick?.() })
  menu.appendChild(item)
}

function showChipMenu() {
  hideMenus()
  showMenuBackdrop()
  const menu = $('#chipmenu')
  menu.textContent = ''
  const st = state.server ?? {}
  menuItem(menu, { label: '状态：' + ((SERVER_LABELS[st.state] ?? st.state) + '（' + st.url + '）'), disabled: true })
  menu.appendChild(el('div', 'sep'))
  menuItem(menu, { label: '重新检测', onClick: () => void api.server.recheck() })
  menuItem(menu, { label: '启动服务', disabled: st.state === 'online' || st.state === 'starting', onClick: () => void api.server.start() })
  menuItem(menu, { label: '重启服务', disabled: !st.ownsServer, onClick: () => void api.server.restart() })
  menuItem(menu, { label: '停止服务', disabled: !st.ownsServer || st.state !== 'online', onClick: () => void api.server.stop() })
  menu.appendChild(el('div', 'sep'))
  menuItem(menu, { label: '查看日志', hint: 'Ctrl+Shift+L', onClick: () => openLogs() })
  menuItem(menu, { label: '在系统浏览器中打开', onClick: () => void api.app.openExternal(st.homeUrl) })
  positionMenu(menu, $('#serverchip'))
}

function showAppMenu() {
  hideMenus()
  showMenuBackdrop()
  const menu = $('#appmenu')
  menu.textContent = ''
  const t = activeTab()
  menuItem(menu, { label: '新建标签页', hint: 'Ctrl+T', onClick: () => void openNewTab(null) })
  menu.appendChild(el('div', 'sep'))
  const ns = navState(t)
  menuItem(menu, { label: '后退', hint: 'Alt+←', disabled: !ns.back, onClick: () => t.el.goBack() })
  menuItem(menu, { label: '前进', hint: 'Alt+→', disabled: !ns.fwd, onClick: () => t.el.goForward() })
  menuItem(menu, { label: '重新加载', hint: 'Ctrl+R', disabled: !t || isAppUrl(t.url), onClick: () => t.el.reload() })
  menuItem(menu, { label: '主页', onClick: () => { if (t) void api.tabs.navigate(t.id, state.env.home) } })
  menu.appendChild(el('div', 'sep'))
  menuItem(menu, { label: '开发者工具（页面）', disabled: !t, onClick: () => t.el.openDevTools() })
  menuItem(menu, { label: '开发者工具（界面）', onClick: () => void api.app.shellDevTools() })
  menu.appendChild(el('div', 'sep'))
  menuItem(menu, { label: '窗口置顶', checked: state.settings?.shell?.alwaysOnTop, onClick: () => void api.app.toggleAlwaysOnTop() })
  menu.appendChild(el('div', 'sep'))
  menuItem(menu, { label: '服务器日志', onClick: () => openLogs() })
  menuItem(menu, { label: '设置', hint: 'Ctrl+,', onClick: () => openSettings() })
  menuItem(menu, { label: '关于', onClick: () => openAbout() })
  menu.appendChild(el('div', 'sep'))
  menuItem(menu, { label: '退出', onClick: () => void api.app.quit() })
  positionMenu(menu, $('#btn-menu'))
}

function showTabMenu(e, id) {
  e.preventDefault()
  hideMenus()
  const t = state.tabs.get(id)
  if (!t) return
  const menu = el('div', 'menu')
  menu.id = 'tabmenu'
  menuItem(menu, { label: '重新加载', disabled: isAppUrl(t.url), onClick: () => t.el.reload() })
  menuItem(menu, { label: '复制地址', onClick: () => { navigator.clipboard?.writeText(t.url).catch(() => {}) } })
  menuItem(menu, { label: '在系统浏览器中打开', disabled: isAppUrl(t.url), onClick: () => void api.app.openExternal(t.url) })
  menu.appendChild(el('div', 'sep'))
  menuItem(menu, { label: '关闭标签页', onClick: () => closeTab(id) })
  menuItem(menu, { label: '关闭其他标签页', disabled: state.order.length <= 1, onClick: () => { for (const tid of state.order.slice()) if (tid !== id) closeTab(tid) } })
  document.body.appendChild(menu)
  menu.style.left = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8) + 'px'
  menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8) + 'px'
}

/* ---------------- 模态框 ---------------- */
function openModal(name) {
  hideMenus()
  $('#modal-backdrop').classList.remove('hidden')
  $$('.modal').forEach((m) => m.classList.add('hidden'))
  $('#modal-' + name).classList.remove('hidden')
  if (name === 'settings') fillSettings()
  if (name === 'logs') openLogsView()
  if (name === 'about') fillAbout()
}

function closeModal() {
  $('#modal-backdrop').classList.add('hidden')
  $$('.modal').forEach((m) => m.classList.add('hidden'))
  state.logsOpen = false
}

function fillSettings() {
  const s = state.settings
  if (!s) return
  $('#set-host').value = s.server.host
  $('#set-port').value = s.server.port
  $('#set-autostart').checked = !!s.server.autoStart
  $('#set-command').value = s.server.command
  $('#set-workspace').value = s.server.workspaceDir
  $('#set-stoponquit').checked = !!s.server.stopServerOnQuit
  $('#set-extrahosts').value = (s.server.extraHosts ?? []).join(', ')
  $('#set-allowexternal').checked = !!s.shell.allowExternalInApp
  $('#set-restoretabs').checked = !!s.shell.restoreTabs
  $('#set-closetotray').checked = !!s.shell.closeToTray
  $('#set-alwaysontop').checked = !!s.shell.alwaysOnTop
  $('#set-theme').value = s.shell.theme ?? 'follow'
}

async function saveSettings() {
  const port = Number($('#set-port').value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    toast('端口必须是 1-65535 的整数', 'error')
    return
  }
  const patch = {
    server: {
      host: $('#set-host').value.trim() || '127.0.0.1',
      port,
      autoStart: $('#set-autostart').checked,
      command: $('#set-command').value.trim() || 'dsh',
      workspaceDir: $('#set-workspace').value.trim(),
      stopServerOnQuit: $('#set-stoponquit').checked,
      extraHosts: $('#set-extrahosts').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    },
    shell: {
      allowExternalInApp: $('#set-allowexternal').checked,
      restoreTabs: $('#set-restoretabs').checked,
      closeToTray: $('#set-closetotray').checked,
      alwaysOnTop: $('#set-alwaysontop').checked,
      theme: $('#set-theme').value
    }
  }
  state.settings = await api.settings.set(patch)
  toast('设置已保存', 'ok')
  closeModal()
}

function openLogs() {
  openModal('logs')
}

function openSettings() {
  openModal('settings')
}

function openAbout() {
  openModal('about')
}

let logLines = 0
async function openLogsView() {
  state.logsOpen = true
  logLines = 0
  const view = $('#logs-view')
  view.textContent = ''
  const logs = await api.server.logs()
  for (const l of logs.slice(-400)) appendLogLine(l)
  if (!logs.length) view.textContent = '（暂无日志）'
}

function appendLogLine(l) {
  const view = $('#logs-view')
  if (view.textContent === '（暂无日志）') view.textContent = ''
  const line = el('span')
  line.appendChild(el('span', 'meta', '[' + fmtTime(l.ts) + '] '))
  const body = el('span', l.stream === 'err' ? 'err' : '', l.text)
  line.appendChild(body)
  view.appendChild(line)
  view.appendChild(document.createTextNode('\n'))
  logLines++
  while (logLines > 500 && view.firstChild) {
    view.removeChild(view.firstChild)
    logLines--
  }
  if ($('#logs-autoscroll').checked) {
    const body = $('#modal-logs .modal-body')
    body.scrollTop = body.scrollHeight
  }
}

async function fillAbout() {
  const info = await api.app.info()
  const rows = [
    ['版本', info.version],
    ['Electron', info.electron],
    ['Chromium', info.chrome],
    ['Node.js', info.node],
    ['服务器地址', info.homeUrl],
    ['dsh 命令', info.dshCommand || '（未探测，将在首次启动服务时解析）'],
    ['用户数据目录', info.userData]
  ]
  const table = $('#about-table')
  table.textContent = ''
  for (const [k, v] of rows) {
    const tr = el('tr')
    tr.appendChild(el('td', '', k))
    tr.appendChild(el('td', '', String(v)))
    table.appendChild(tr)
  }
}

/* ---------------- 初始化 ---------------- */
async function init() {
  // 事件订阅
  api.events.onNewTab((url) => void openNewTab(url))
  api.events.onCloseActiveTab(() => { const t = activeTab(); if (t) void closeTab(t.id) })
  api.events.onFocusAddress(() => { $('#address').focus(); $('#address').select() })
  api.events.onOpenSettings(() => openModal('settings'))
  api.events.onOpenLogs(() => openLogs())
  api.events.onOpenAbout(() => openModal('about'))
  api.events.onToast(({ message, kind }) => toast(message, kind))
  api.events.onNav((cmd) => {
    const t = activeTab()
    if (!t || !t.ready) return
    const ns = navState(t)
    try {
      if (cmd === 'back' && ns.back) t.el.goBack()
      else if (cmd === 'forward' && ns.fwd) t.el.goForward()
      else if (cmd === 'reload' && !isAppUrl(t.url)) t.el.reload()
      else if (cmd === 'force-reload') (t.el.reloadIgnoringCache ?? t.el.reload).call(t.el)
      else if (cmd === 'home') void api.tabs.navigate(t.id, state.env.home)
    } catch { /* dom-ready 竞态，忽略 */ }
  })
  api.server.onStatus((st) => setServer(st))
  api.server.onLog((line) => { if (state.logsOpen) appendLogLine(line) })
  api.win.onState((ws) => {
    document.body.classList.toggle('maximized', !!ws.maximized)
  })
  api.events.onTheme(({ theme }) => applyTheme(theme))

  // 环境信息
  const info = await api.env.ready()
  state.env = info
  state.server = info.serverStatus
  setServer(info.serverStatus)
  state.settings = await api.settings.get()
  if (info.theme) applyTheme(info.theme)

  // 初始标签页
  for (const u of info.initialTabs ?? []) {
    await openNewTab(u)
  }
  refreshChrome()

  // 窗口控制
  $('#btn-min').addEventListener('click', () => void api.win.minimize())
  $('#btn-max').addEventListener('click', () => void api.win.toggleMaximize())
  $('#btn-close').addEventListener('click', () => void api.win.close())
  $('#titlebar').addEventListener('dblclick', (e) => {
    if (e.target.closest('button, input, #tabstrip, .tab, .brand')) return
    void api.win.toggleMaximize()
  })

  // 标签页操作
  $('#btn-newtab').addEventListener('click', () => void openNewTab(null))

  // 导航
  $('#btn-back').addEventListener('click', () => { const t = activeTab(); if (t && navState(t).back) t.el.goBack() })
  $('#btn-fwd').addEventListener('click', () => { const t = activeTab(); if (t && navState(t).fwd) t.el.goForward() })
  $('#btn-reload').addEventListener('click', () => {
    const t = activeTab()
    if (t && !isAppUrl(t.url)) t.el.reload()
  })
  $('#btn-home').addEventListener('click', () => { const t = activeTab(); if (t) void api.tabs.navigate(t.id, state.env.home) })

  // 地址栏
  const address = $('#address')
  address.addEventListener('focus', () => { state.addressFocused = true; address.select() })
  address.addEventListener('blur', () => { state.addressFocused = false; refreshChrome() })
  address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); void navigateActive(address.value); address.blur() }
    if (e.key === 'Escape') { e.preventDefault(); refreshChrome(); address.blur() }
  })

  // 菜单
  $('#serverchip').addEventListener('click', () => showChipMenu())
  $('#btn-menu').addEventListener('click', () => showAppMenu())
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu') && !e.target.closest('#serverchip') && !e.target.closest('#btn-menu')) hideMenus()
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hideMenus(); closeModal() }
  })

  // 模态框
  $('#modal-backdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal()
  })
  $$('.modal-x, [data-close]').forEach((b) => b.addEventListener('click', () => closeModal()))
  $('#btn-save-settings').addEventListener('click', () => void saveSettings())
  $('#btn-reset-settings').addEventListener('click', async () => {
    state.settings = await api.settings.reset()
    fillSettings()
    toast('已恢复默认设置', 'ok')
  })
  $('#btn-clear-logs').addEventListener('click', () => {
    $('#logs-view').textContent = '（暂无日志）'
    logLines = 0
    void api.server.clearLogs()
  })

  // 新标签页快捷键（外壳内 fallback，菜单加速器之外的保险）
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === 't' && !e.target.closest('input')) {
      e.preventDefault()
      void openNewTab(null)
    }
  })
}

init().catch((err) => {
  console.error('[shell] init failed:', err)
})
