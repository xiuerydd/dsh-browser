// 从 DSH 官方 favicon 生成应用图标：蓝色圆角底 + 白色鲸鱼
// sharp 复用 dsh 全局安装包里的依赖（无需额外安装）。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const ASSETS = path.join(ROOT, 'assets')
const OUT = path.join(ASSETS, 'icons')

// 解析 sharp：需要 DSH_NODE_MODULES 环境变量指向一个含 sharp 依赖的 node_modules 目录
// 例（PowerShell）: $env:DSH_NODE_MODULES='C:\path\to\dsh\node_modules'; node scripts/make-icons.mjs
const DSH_NM = process.env.DSH_NODE_MODULES
if (!DSH_NM) {
  console.error('make-icons: 需要设置 DSH_NODE_MODULES 环境变量（指向含 sharp 的 node_modules 目录）')
  process.exit(1)
}
const req = createRequire(pathToFileURL(path.join(DSH_NM, '__resolve__.js')))
const sharp = req('sharp')

const ACCENT = '#4176e6' // DSH 品牌蓝 --dsw-static-deepseek-450 / rgb(65,118,230)

function whiteWhale() {
  let svg = fs.readFileSync(path.join(ASSETS, 'dsh-favicon.svg'), 'utf8')
  // 去掉 @media 样式（libvips 不处理媒体查询），直接给 path 上白色
  svg = svg.replace(/<style>[\s\S]*?<\/style>/, '')
  svg = svg.replace(/fill="#000"/, 'fill="#ffffff"')
  return Buffer.from(svg)
}

const bg = Buffer.from(
  `<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg"><rect width="512" height="512" rx="116" fill="${ACCENT}"/></svg>`
)

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

fs.mkdirSync(OUT, { recursive: true })

// 512 主图
const whale512 = await sharp(whiteWhale()).resize(320, 320).png().toBuffer()
await sharp(bg).composite([{ input: whale512, top: 96, left: 96 }]).png().toFile(path.join(OUT, 'icon.png'))
console.log('icon.png (512)')

// 各尺寸 PNG（用于 ICO 与托盘）
const pngs = {}
for (const s of SIZES) {
  const p = path.join(OUT, `icon-${s}.png`)
  await sharp(path.join(OUT, 'icon.png')).resize(s, s).png().toFile(p)
  pngs[s] = fs.readFileSync(p)
  console.log(`icon-${s}.png`)
}

// 托盘图标（32px 即可）
fs.writeFileSync(path.join(OUT, 'tray.png'), pngs[32])

// 组装 ICO（PNG 编码条目，Vista+ 支持）
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(icoSizes.length, 4)

const dir = Buffer.alloc(16 * icoSizes.length)
let offset = 6 + dir.length
icoSizes.forEach((s, i) => {
  const data = pngs[s]
  const e = i * 16
  dir.writeUInt8(s === 256 ? 0 : s, e + 0)
  dir.writeUInt8(s === 256 ? 0 : s, e + 1)
  dir.writeUInt8(0, e + 2)  // palette
  dir.writeUInt8(0, e + 3)  // reserved
  dir.writeUInt16LE(1, e + 4)  // planes
  dir.writeUInt16LE(32, e + 6) // bpp
  dir.writeUInt32LE(data.length, e + 8)
  dir.writeUInt32LE(offset, e + 12)
  offset += data.length
})
const ico = Buffer.concat([header, dir, ...icoSizes.map((s) => pngs[s])])
fs.writeFileSync(path.join(OUT, 'dsh-browser.ico'), ico)
console.log('dsh-browser.ico (' + ico.length + ' bytes)')
console.log('DONE ->', OUT)
