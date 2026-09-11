import { execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

// 内置 dsh 的候选位置（按优先级）：
//   1. 打包版：resources/dsh-runtime/node_modules/...（extraResources 整体投放，不经依赖推断）
//   2. 打包版兜底：resources/app.asar.unpacked/node_modules/...
//   3. 开发版：项目 node_modules/...
const BUNDLED_DSH_CANDIDATES = [
  process.resourcesPath ? path.join(process.resourcesPath, 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js') : '',
  process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js') : '',
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
].filter(Boolean)

const execFileP = promisify(execFile)

const MAX_LOGS = 600
const START_TIMEOUT_MS = 45000

/**
 * 管理 DeepSeek Harness Web 服务（dsh web）：
 * - 探测本机端口是否已有服务
 * - 未启动时按需拉起 dsh web，采集日志
 * - 周期健康检查，状态变化通过事件广播
 */
export class ServerManager extends EventEmitter {
  constructor(settings) {
    super()
    this.settings = settings
    this.state = 'checking' // checking | online | starting | stopped | error
    this.ownsServer = false
    this.child = null
    this.commandPath = null
    this.webToken = null
    this.logs = []
    this._timer = null
    this._startedAt = 0
  }

  get url() {
    const s = this.settings.get('server')
    return `http://${s.host}:${s.port}`
  }

  get homeUrl() {
    // 新版 dsh web 启动后会打印带 token 的访问地址；token 由 stdout 自动捕获
    return this.webToken ? `${this.url}/?token=${encodeURIComponent(this.webToken)}` : this.url + '/'
  }

  get ctx() {
    const s = this.settings.get('server')
    return { host: s.host, port: s.port, extraHosts: s.extraHosts ?? [] }
  }

  status() {
    return {
      state: this.state,
      url: this.url,
      homeUrl: this.homeUrl,
      ownsServer: this.ownsServer,
      commandPath: this.commandPath,
      webToken: this.webToken,
      startedAt: this._startedAt,
      logCount: this.logs.length
    }
  }

  log(stream, text) {
    this.logs.push({ ts: Date.now(), stream, text })
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS)
    this.emit('log', this.logs[this.logs.length - 1])
  }

  clearLogs() {
    this.logs = []
    this.emit('logs-cleared')
  }

  #setState(state) {
    if (this.state === state) return
    this.state = state
    this.emit('status', this.status())
  }

  /** 探测本机 DSH 服务是否可达（任何 HTTP 响应即视为在线）。 */
  checkOnline() {
    const s = this.settings.get('server')
    return new Promise((resolve) => {
      const req = http.request(
        { host: s.host, port: s.port, path: '/', method: 'GET', timeout: 2000 },
        (res) => { res.resume(); resolve(true) }
      )
      req.on('timeout', () => { req.destroy(); resolve(false) })
      req.on('error', () => resolve(false))
      req.end()
    })
  }

  /** Windows: 谁在监听这个端口（netstat 解析）；不可用时返回 null。 */
  async listeningPid(port) {
    try {
      const { stdout } = await execFileP('netstat.exe', ['-ano', '-p', 'tcp'])
      for (const line of stdout.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length >= 5 && parts[3] === 'LISTENING' && parts[1].endsWith(':' + port)) {
          const pid = Number(parts[4])
          if (Number.isInteger(pid) && pid > 0) return pid
        }
      }
    } catch {
      // netstat unavailable: fall through
    }
    return null
  }

  async #resolveCommand() {
    const cmd = String(this.settings.get('server.command') || 'dsh').trim()
    if (/[\\/]/.test(cmd)) {
      this.commandPath = cmd
      return { cmd }
    }
    if (process.platform === 'win32') {
      // 直接在 PATH 中找 <cmd>.cmd/.exe/.bat：
      // where.exe 的输出是控制台编码（GBK），中文用户名路径会被按 UTF-8 误解码成损坏路径；
      // 且同名无扩展 sh 脚本会被排在首位，shell:true 的 cmd.exe 无法执行。
      const exts = ['.cmd', '.exe', '.bat']
      for (const dir of (process.env.PATH || '').split(';')) {
        if (!dir.trim()) continue
        for (const ext of exts) {
          const p = path.join(dir.trim(), cmd + ext)
          if (fs.existsSync(p)) {
            this.commandPath = p
            return { cmd: p }
          }
        }
      }
    }
    // 内置 dsh 兜底：随安装包分发（resources/dsh-runtime）或项目 node_modules 中的副本，
    // 以 Electron 自带 Node 运行（ELECTRON_RUN_AS_NODE=1），无需系统安装 Node/dsh。
    //
    // --expose-internals 是必需的：web profile 默认 patchReload="live"，会加载
    // cordis-plugin-hmr，而该插件要求 Node 以 --expose-internals 启动，否则插件树
    // 加载失败、进程在约 40 秒后退出（且期间端口是 LISTENING 的，容易被误判为正常）。
    for (const bundled of BUNDLED_DSH_CANDIDATES) {
      if (fs.existsSync(bundled)) {
        this.commandPath = bundled
        return { cmd: process.execPath, preArgs: ['--expose-internals', bundled], bundled: true }
      }
    }
    try {
      const { stdout } = await execFileP('where.exe', [cmd])
      const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
      const first = process.platform === 'win32'
        ? (lines.find((l) => l.toLowerCase().endsWith('.cmd')) ?? lines[0])
        : lines[0]
      if (first) {
        this.commandPath = first
        return { cmd: first }
      }
    } catch {
      // not found
    }
    this.commandPath = null
    return null
  }

  async start({ force = false } = {}) {
    if (this.child && !force) return this.status()
    if (this.child && force) await this.stop()

    if (await this.checkOnline()) {
      const s0 = this.settings.get('server')
      const stored = this.settings.get('server.lastChildPid')
      const pid = await this.listeningPid(s0.port)
      this.ownsServer = stored != null && pid != null && Number(stored) === Number(pid)
      if (this.ownsServer) this.log('out', '[dsh-browser] 已认领上次启动的服务 (PID ' + pid + ')')
      this.#setState('online')
      this.#startPolling(false)
      return this.status()
    }

    const { autoStart } = this.settings.get('server')
    if (!autoStart && !force) {
      this.#setState('stopped')
      return this.status()
    }

    this.#setState('starting')
    this.log('out', '[dsh-browser] 正在启动 dsh web 服务 ...')
    const resolved = await this.#resolveCommand()
    if (!resolved) {
      this.log('err', '[dsh-browser] 未找到 dsh：安装版应自带（resources/dsh）；开发环境请安装 @deepseek-ai/dsh（npm i -g @deepseek-ai/dsh）或在设置中填写启动命令')
      this.#setState('error')
      return this.status()
    }

    const s = this.settings.get('server')
    const args = ['web', '--port', String(s.port)]
    if (s.host && s.host !== '127.0.0.1') args.push('--host', s.host)
    this._startedAt = Date.now()
    const spawnCmd = resolved.cmd
    const spawnArgs = [...(resolved.preArgs ?? []), ...args]
    this.log('out', `[dsh-browser] $ ${[spawnCmd, ...spawnArgs].join(' ')}`)
    try {
      // 内置 dsh 以 Electron 自带 Node 运行。必须剥掉外部注入的 NODE_OPTIONS：
      // 它可能带 --require 或其它 Node 参数，干扰 dsh 自身的文件锁与子进程行为
      // （实测 NODE_OPTIONS 里挂 fs hook 会导致 dsh 删不掉 profile 锁而启动超时）。
      const childEnv = { ...process.env }
      if (resolved.bundled) {
        delete childEnv.NODE_OPTIONS
        childEnv.ELECTRON_RUN_AS_NODE = '1'
      }
      this.child = spawn(spawnCmd, spawnArgs, {
        cwd: s.workspaceDir || os.homedir(),
        shell: !resolved.bundled,
        windowsHide: true,
        env: childEnv
      })
      this.ownsServer = true
    } catch (err) {
      this.log('err', `[dsh-browser] 启动失败: ${err.message}`)
      this.#setState('error')
      return this.status()
    }

    this.child.stdout?.on('data', (d) => {
      for (const line of String(d).split(/\r?\n/)) if (line.trim()) { this.log('out', line); this.#maybeCaptureToken(line) }
    })
    this.child.stderr?.on('data', (d) => {
      for (const line of String(d).split(/\r?\n/)) if (line.trim()) { this.log('err', line); this.#maybeCaptureToken(line) }
    })
    this.child.on('error', (err) => {
      this.log('err', `[dsh-browser] 进程错误: ${err.message}`)
    })
    this.child.on('exit', (code, signal) => {
      this.log('out', `[dsh-browser] 服务进程已退出 (code=${code} signal=${signal ?? 'none'})`)
      this.child = null
      this.ownsServer = false
      this.webToken = null
      this.settings.set({ server: { lastChildPid: null } })
      if (this.state === 'starting' || this.state === 'online') this.#setState('stopped')
    })

    this.#startPolling(true)
    return this.status()
  }

  async stop() {
    this.#stopPolling()
    if (this.child) {
      const child = this.child
      this.child = null
      this.ownsServer = false
      this.log('out', '[dsh-browser] 正在停止服务 ...')
      if (process.platform === 'win32') {
        await new Promise((resolve) => {
          execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => resolve())
        })
      } else {
        child.kill('SIGTERM')
      }
      this.log('out', '[dsh-browser] 服务已停止')
    } else if (this.ownsServer) {
      const stored = this.settings.get('server.lastChildPid')
      if (stored != null) {
        // 防 PID 复用误杀：仅当该 PID 仍在监听配置端口时才动手（与启动认领逻辑同口径）
        const live = await this.listeningPid(this.settings.get('server.port'))
        if (live != null && Number(live) === Number(stored)) {
          this.log('out', '[dsh-browser] 正在停止服务 (PID ' + live + ') ...')
          if (process.platform === 'win32') {
            await new Promise((resolve) => {
              execFile('taskkill', ['/pid', String(live), '/T', '/F'], () => resolve())
            })
          } else {
            try {
              process.kill(Number(live), 'SIGTERM')
            } catch {}
          }
          this.log('out', '[dsh-browser] 服务已停止')
        } else {
          this.log('out', '[dsh-browser] 记录的服务 PID ' + stored + ' 已不在监听本端口，跳过停止（服务可能已被外部关闭，或 PID 已被复用）')
        }
      }
    }
    this.ownsServer = false
    this.settings.set({ server: { lastChildPid: null } })
    this.#setState('stopped')
  }

  async restart() {
    await this.stop()
    return this.start({ force: true })
  }

  /** 解析 dsh 命令路径（不启动）。 */
  async resolveCommandNow() {
    return this.#resolveCommand()
  }

  /** 手动重新探测服务状态。 */
  async recheck() {
    this.#setState('checking')
    this.#startPolling(false)
    return this.status()
  }

  /** 设置变更后重新对表当前配置。 */
  async reconfigure() {
    if (this.child) {
      await this.stop()
      if (this.settings.get('server.autoStart')) return this.start({ force: true })
      return this.status()
    }
    this.#setState('checking')
    this.#startPolling(false)
    return this.status()
  }

  /** 从 dsh web 启动输出中捕获访问 token（如 "dsh web: http://127.0.0.1:3080/?token=xxx"）。 */
  #maybeCaptureToken(line) {
    const m = /https?:\/\/\S*[?&]token=([A-Za-z0-9_\-]+)/.exec(String(line))
    if (!m || m[1] === this.webToken) return
    this.webToken = m[1]
    this.log('out', '[dsh-browser] 已捕获 dsh web 访问 token，标签页将自动携带')
    this.emit('token', this.webToken)
  }

  #startPolling(fast = false) {
    this.#stopPolling()
    const interval = fast ? 1000 : (this.settings.get('server.pollIntervalMs') || 3000)
    this._timer = setInterval(() => void this.#poll(), interval)
    this._timer.unref?.()
    void this.#poll()
  }

  #stopPolling() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  }

  async #poll() {
    const online = await this.checkOnline()
    const was = this.state
    if (online) {
      if (was !== 'online') {
        this.#setState('online')
        if (this.child) this.log('out', `[dsh-browser] 服务已就绪: ${this.url}`)
        this.#startPolling(false)
      }
      // shell:true 下 child.pid 是 cmd 壳的 PID，这里记录真实监听 PID，供下次启动认领
      if (this.ownsServer) {
        const pid = await this.listeningPid(this.settings.get('server.port'))
        const prev = this.settings.get('server.lastChildPid')
        if (pid != null && Number(prev) !== Number(pid)) {
          this.settings.set({ server: { lastChildPid: pid } })
        }
      }
    } else if (was === 'online' || was === 'checking') {
      this.#setState(this.child ? 'starting' : 'stopped')
    } else if (was === 'starting') {
      if (this.child && Date.now() - this._startedAt > START_TIMEOUT_MS) {
        this.log('err', '[dsh-browser] 服务启动超时（45 秒），请查看上方日志排查端口占用或 dsh 配置')
        this.#setState('error')
      }
    }
  }
}
