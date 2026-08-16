import { execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import http from 'node:http'
import os from 'node:os'
import { promisify } from 'node:util'

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
    this.logs = []
    this._timer = null
    this._startedAt = 0
  }

  get url() {
    const s = this.settings.get('server')
    return `http://${s.host}:${s.port}`
  }

  get homeUrl() { return this.url + '/' }

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
      return cmd
    }
    try {
      const { stdout } = await execFileP('where.exe', [cmd])
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
      if (first) {
        this.commandPath = first
        return first
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
    const cmd = await this.#resolveCommand()
    if (!cmd) {
      this.log('err', '[dsh-browser] 未找到 dsh 命令：请安装 @deepseek-ai/dsh（npm i -g @deepseek-ai/dsh），或在设置中填写启动命令')
      this.#setState('error')
      return this.status()
    }

    const s = this.settings.get('server')
    const args = ['web', '--port', String(s.port)]
    if (s.host && s.host !== '127.0.0.1') args.push('--host', s.host)
    this._startedAt = Date.now()
    this.log('out', `[dsh-browser] $ ${cmd} ${args.join(' ')}`)
    try {
      this.child = spawn(cmd, args, {
        cwd: s.workspaceDir || os.homedir(),
        shell: true,
        windowsHide: true,
        env: { ...process.env }
      })
      this.ownsServer = true
      this.settings.set({ server: { lastChildPid: this.child.pid } })
    } catch (err) {
      this.log('err', `[dsh-browser] 启动失败: ${err.message}`)
      this.#setState('error')
      return this.status()
    }

    this.child.stdout?.on('data', (d) => {
      for (const line of String(d).split(/\r?\n/)) if (line.trim()) this.log('out', line)
    })
    this.child.stderr?.on('data', (d) => {
      for (const line of String(d).split(/\r?\n/)) if (line.trim()) this.log('err', line)
    })
    this.child.on('error', (err) => {
      this.log('err', `[dsh-browser] 进程错误: ${err.message}`)
    })
    this.child.on('exit', (code, signal) => {
      this.log('out', `[dsh-browser] 服务进程已退出 (code=${code} signal=${signal ?? 'none'})`)
      this.child = null
      this.ownsServer = false
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
        this.log('out', '[dsh-browser] 正在停止服务 (PID ' + stored + ') ...')
        if (process.platform === 'win32') {
          await new Promise((resolve) => {
            execFile('taskkill', ['/pid', String(stored), '/T', '/F'], () => resolve())
          })
        } else {
          try {
            process.kill(Number(stored), 'SIGTERM')
          } catch {}
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
