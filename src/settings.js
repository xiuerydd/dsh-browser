import { app } from 'electron'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DEFAULTS = {
  server: {
    host: '127.0.0.1',
    port: 3080,
    autoStart: true,
    command: 'dsh',
    workspaceDir: os.homedir(),
    pollIntervalMs: 3000,
    stopServerOnQuit: false,
    extraHosts: []
  },
  shell: {
    allowExternalInApp: false,
    closeToTray: false,
    restoreTabs: true,
    keepOneTab: true,
    alwaysOnTop: false,
    theme: 'follow',
    resolvedTheme: null
  },
  window: {
    bounds: null,
    maximized: false
  },
  lastTabs: []
}

export class Settings extends EventEmitter {
  constructor() {
    super()
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.data = this.#deep(DEFAULTS)
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.data = this.#merge(this.#deep(DEFAULTS), raw)
    } catch {
      // first run or corrupt file: keep defaults
    }
  }

  #deep(v) { return JSON.parse(JSON.stringify(v)) }

  #isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

  #merge(base, patch) {
    const out = this.#deep(base)
    for (const [k, v] of Object.entries(patch ?? {})) {
      out[k] = this.#isObj(v) && this.#isObj(out[k]) ? this.#merge(out[k], v) : v
    }
    return out
  }

  get(pathStr) {
    return pathStr.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data)
  }

  set(patch) {
    this.data = this.#merge(this.data, patch)
    this.save()
    this.emit('change', patch)
  }

  reset() {
    this.data = this.#deep(DEFAULTS)
    this.save()
    this.emit('change', null)
  }

  save() {
    try {
      const tmp = this.file + '.tmp'
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error('[dsh-browser] settings save failed:', err)
    }
  }
}
