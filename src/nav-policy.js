/** 导航策略：DSH 专用浏览器只允许加载内部页面（dshb:// 应用页 + 本机 DSH 服务）。 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * 把地址栏输入规范化为完整 URL：
 * - 已有协议 → 原样
 * - 127.0.0.1:3080 / localhost:3080/x → 补 http://
 * - /path → 基于 base origin 解析
 * - 其他（域名等）→ 按 http:// 猜测
 */
export function normalizeTarget(input, baseUrl) {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  // localhost 特判：否则会命中下面的 scheme 检查，被当作 "localhost:" 协议判成 external
  if (/^localhost(:\d+)?(\/\S*)?$/i.test(raw)) return 'http://' + raw
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw
  if (raw.startsWith('//')) return 'http:' + raw
  if (/^(\[[0-9a-f:]+\]|[0-9a-f:.]+)(:\d+)?(\/\S*)?$/i.test(raw)) return 'http://' + raw
  try {
    const base = new URL(baseUrl)
    const p = raw.startsWith('/') ? raw : '/' + raw
    return new URL(p, base.origin).href
  } catch {
    return null
  }
}

/**
 * 分类目标 URL：
 * - 'app'      应用内置页面（dshb:// 通知页、about:blank）
 * - 'internal' 允许在标签页内加载（本机 DSH 服务；开启 allowExternalInApp 后含全部 http(s)）
 * - 'external' 需要转交系统浏览器
 */
export function classify(urlString, ctx = {}) {
  let u
  try { u = new URL(urlString) } catch { return 'external' }
  if (u.protocol === 'dshb:' || u.protocol === 'about:') return 'app'
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'external'
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80)
  const host = u.hostname.toLowerCase()
  const extra = new Set((ctx.extraHosts ?? []).map((h) => String(h).toLowerCase()))
  if ((LOOPBACK_HOSTS.has(host) || extra.has(host)) && port === Number(ctx.port)) return 'internal'
  if (ctx.allowExternalInApp) return 'internal'
  return 'external'
}
