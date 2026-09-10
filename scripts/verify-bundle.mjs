// 校验打包产物里的 node_modules 是否包含 dsh 的完整运行时闭包。
//
// 为什么需要这个脚本：
//   electron-builder 的依赖收集器只跟 package.json 的 `dependencies` 链，
//   完全忽略 `peerDependencies`。而 @deepseek-ai/dsh 生态有 218 个包把依赖
//   声明在 peerDependencies 里，导致构建时静默漏包（如 cordis-plugin-group），
//   装上去运行时才报 ERROR_MODULE_NOT_FOUND，白白浪费一整轮构建时间。
//
// 用法：
//   node scripts/verify-bundle.mjs <产物 node_modules 路径>
//   退出码 0 = 完整；1 = 有缺失（会列出包名）

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcModules = path.join(projectRoot, 'node_modules')

const targetArg = process.argv[2]
if (!targetArg) {
  console.error('用法: node scripts/verify-bundle.mjs <产物 node_modules 路径>')
  process.exit(2)
}
const outModules = path.resolve(projectRoot, targetArg)

/** 读取某个包在源码 node_modules 里的 package.json */
function loadPkg(name) {
  const pj = path.join(srcModules, ...name.split('/'), 'package.json')
  if (!fs.existsSync(pj)) return null
  try {
    return JSON.parse(fs.readFileSync(pj, 'utf8'))
  } catch {
    return null
  }
}

/** 一个包声明的运行时依赖：dependencies + peerDependencies */
function runtimeDepsOf(pkg) {
  const out = new Set()
  for (const key of ['dependencies', 'peerDependencies']) {
    for (const dep of Object.keys(pkg[key] ?? {})) out.add(dep)
  }
  return out
}

// 从 @deepseek-ai/dsh 出发，算出完整运行时闭包
const closure = new Set()
const stack = ['@deepseek-ai/dsh']
while (stack.length) {
  const name = stack.pop()
  if (closure.has(name)) continue
  closure.add(name)
  const pkg = loadPkg(name)
  if (!pkg) continue
  for (const dep of runtimeDepsOf(pkg)) {
    if (!closure.has(dep)) stack.push(dep)
  }
}

// peerDependencies 里可能有可选依赖（没装），只统计源码里真实存在的
const expected = [...closure].filter((n) => loadPkg(n) !== null)

const present = []
const missing = []
for (const name of expected) {
  const p = path.join(outModules, ...name.split('/'))
  ;(fs.existsSync(p) ? present : missing).push(name)
}

console.log(`运行时闭包共 ${expected.length} 个包`)
console.log(`产物中存在 ${present.length} 个`)
console.log(`缺失        ${missing.length} 个`)

if (missing.length === 0) {
  console.log('\n✓ 依赖闭包完整')
  process.exit(0)
}

console.log('\n✗ 以下包缺失，装上去会报 ERROR_MODULE_NOT_FOUND：')
for (const name of missing.sort()) console.log('   ', name)
process.exit(1)
