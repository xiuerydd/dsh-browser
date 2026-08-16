// CDP 截图辅助：对指定 target 执行 Page.captureScreenshot 并存盘
// 用法: node scripts/cdp-shot.mjs --port 9222 --target shell.html --out shot.png
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const DSH_NM = process.env.DSH_NODE_MODULES
if (!DSH_NM) {
  console.error('需要 DSH_NODE_MODULES 环境变量指向含 ws 的 node_modules')
  process.exit(1)
}
const req = createRequire(pathToFileURL(DSH_NM + '/__resolve__.js'))
const WebSocket = req('ws')

const args = process.argv.slice(2)
const pick = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : dflt }
const port = Number(pick('--port', '9222'))
const targetSel = pick('--target', 'shell.html')
const out = pick('--out', 'shot.png')

const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()
const t = list.find((x) => (x.url || '').includes(targetSel) || (x.title || '').includes(targetSel))
if (!t) { console.error('no target: ' + targetSel); process.exit(1) }

const ws = new WebSocket(t.webSocketDebuggerUrl, { perMessageDeflate: false })
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), 20000)
  ws.on('open', () => {
    ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
  })
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id === 1) {
      clearTimeout(timer)
      if (msg.error) { reject(new Error(JSON.stringify(msg.error))) } else {
        fs.writeFileSync(out, Buffer.from(msg.result.data, 'base64'))
        resolve()
      }
    }
  })
  ws.on('error', reject)
})
console.log('saved: ' + out)
process.exit(0)
