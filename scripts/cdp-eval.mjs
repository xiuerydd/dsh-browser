// CDP 辅助：在指定 target 中执行 JS 并打印结果（开发验证用）
// 用法: node scripts/cdp-eval.mjs [--target <url子串|all>] [--file <js文件>] [--expr "<js>"]
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const DSH_NM = process.env.DSH_NODE_MODULES
if (!DSH_NM) {
  console.error('cdp-eval: 需要设置 DSH_NODE_MODULES 环境变量（指向含 ws 依赖的 node_modules 目录）')
  process.exit(1)
}
const req = createRequire(pathToFileURL(DSH_NM + '/__resolve__.js'))
const WebSocket = req('ws')

const args = process.argv.slice(2)
const pick = (flag, dflt) => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const targetSel = pick('--target', 'shell.html')
const CDP_PORT = Number(pick('--port', '9222'))
const exprFile = pick('--file', null)
const expr = pick('--expr', null)
const code = exprFile ? fs.readFileSync(exprFile, 'utf8') : (expr || 'document.title')

const list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json()

function matches(t) {
  if (targetSel === 'all') return true
  return (t.url || '').includes(targetSel) || (t.title || '').includes(targetSel)
}

// --watch 模式：开启 Runtime/Log 并刷新页面，收集控制台与异常
if (args.includes('--watch')) {
  const duration = Number(pick('--watch', '6000'))
  const targets = list.filter(matches)
  if (!targets.length) { console.error('NO TARGET'); process.exit(1) }
  for (const t of targets) {
    const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false })
    const events = []
    const done = new Promise((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }))
        ws.send(JSON.stringify({ id: 2, method: 'Log.enable' }))
        ws.send(JSON.stringify({ id: 3, method: 'Page.enable' }))
        setTimeout(() => ws.send(JSON.stringify({ id: 4, method: 'Page.reload', params: { ignoreCache: true } })), 300)
        setTimeout(resolve, duration + 2000)
      })
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString())
        if (msg.method === 'Runtime.consoleAPICalled') {
          const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
          events.push('console.' + msg.params.type + ': ' + args.slice(0, 300))
        } else if (msg.method === 'Runtime.exceptionThrown') {
          events.push('EXCEPTION: ' + JSON.stringify(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text).slice(0, 500))
        } else if (msg.method === 'Log.entryAdded') {
          const e = msg.params.entry
          events.push('log[' + e.level + ']: ' + (e.text || '').slice(0, 300))
        }
      })
    })
    await done
    console.log('=== WATCH TARGET:', t.url)
    console.log(events.length ? events.join('\n') : '(no console output)')
    ws.close()
  }
  process.exit(0)
}

const targets = list.filter(matches)
if (!targets.length) {
  console.error('NO TARGET for ' + targetSel)
  process.exit(1)
}

for (const t of targets) {
  const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false })
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 15000)
    ws.on('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: code, awaitPromise: true, returnByValue: true }
      }))
    })
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.id === 1) {
        clearTimeout(timer)
        resolve(msg.result)
        ws.close()
      }
    })
    ws.on('error', reject)
  })
  console.log('=== TARGET:', t.type, '|', t.url)
  if (result.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(result.exceptionDetails, null, 2))
  } else {
    console.log(JSON.stringify(result.result, null, 2))
  }
}
process.exit(0)
