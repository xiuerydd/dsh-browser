# DeepSeek Harness Browser

仅为 DeepSeek Harness 打造的专用桌面浏览器壳。它把 DeepSeek Harness 的 Web 界面（`dsh web`）装进一个独立的桌面窗口，替代在 Chrome/Edge 里开标签页的使用方式。

## 特性

- **专用窗口**：无边框深色界面 + DSH 鲸鱼品牌标识，与 Harness 观感一致
- **多标签页**：每个标签页是一个独立的 Harness 界面实例；Ctrl+T 新建、中键/× 关闭、右键标签页菜单（重新加载 / 复制地址 / 关闭其他标签页 / 在系统浏览器打开）
- **服务自动管理**：启动时探测本机 DSH 服务，未运行则自动执行 `dsh web --port <端口>`；状态指示灯实时显示（已连接 / 启动中 / 未连接 / 启动失败）
- **通知页与自动恢复**：服务不可达时显示应用内通知页（实时服务日志尾部 + 一键重试/启动服务/在系统浏览器打开），服务恢复后**自动重载**
- **导航策略**：应用内只加载本机 DSH 地址；外部链接一律转交系统默认浏览器（可在设置中改为应用内打开）
- **完整浏览器能力**：后退/前进/刷新/主页、地址栏、页面缩放、全屏、窗口置顶、F12 开发者工具
- **托盘与常驻**：可设置关闭时最小化到托盘，托盘菜单快速新建标签页、退出
- **会话记忆**：窗口位置/大小、上次打开的标签页、全部设置持久化（%APPDATA%\dsh-browser）
- **服务器日志面板**：实时查看 dsh web 输出，排查端口占用、启动失败等问题

## 快速开始

**安装版（推荐）**：双击安装即可——安装包已**内置 DeepSeek Harness（dsh）**，装完无需 Node.js、无需单独安装 dsh，开箱即用。

构建安装包：

```bash
npm install                # 首次：安装 electron / electron-builder / @deepseek-ai/dsh
bash build-installer.sh    # 预检 → 出骨架 → 校验 → 生成 NSIS 安装包
```

`build-installer.sh` 会依次做：

1. **预检 `node_modules` 完整性** —— `scripts/check-node-modules-integrity.py`
   用「每个 `.js.map` 必有对应 `.js`」精确查残缺包。
   （`npm install` 被中断会留下"source map 在、实现文件不在"的包，构建期不报错，
   运行时才炸，症状是**服务端口在监听但所有接口返回 404**。）
2. `electron-builder --win --dir` 出应用骨架
3. **检查骨架健康度** —— `scripts/check-skeleton.py`
   确认自定义图标已写入 exe。构建被中断时 exe 会保留 Electron 默认图标，
   拿它去打包会导致装完图标不对。
4. **校验依赖闭包** —— `scripts/verify-bundle.mjs`
   按 `dependencies` + `peerDependencies` 递归算运行时闭包，0 缺失才继续。
5. **验证内置 dsh 真正可用** —— `scripts/verify-dsh-runtime.py`
   跨过插件树加载窗口后确认进程存活、`GET /` 返回 401。
6. `electron-builder --win nsis --prepackaged` 生成安装包

### 为什么 dsh 放在 devDependencies

`@deepseek-ai/dsh` 是**运行时资源**，但不放在 `dependencies` 里。原因是 electron-builder
的依赖收集器只沿 `dependencies` 链递归，而 dsh 生态有 200+ 个包把依赖声明在
`peerDependencies`，会被静默漏掉（构建成功但运行时报 `ERROR_MODULE_NOT_FOUND`）；
而且收集到的内容会被塞进 `app.asar`，与 `resources/dsh-runtime/` **重复投放约 117MB**。

所以改为：dsh 放 `devDependencies`（保证 `npm install` 会装），
再用 `extraResources` 把整个 `node_modules` 作为资源目录投放到
`resources/dsh-runtime/node_modules`，由 `server.js` 用 `process.execPath` 运行。

> 注意：如果用 `npm install --production` / `npm ci --omit=dev` 安装依赖，
> devDependencies 不会装，`extraResources` 会拷不到 dsh。

### 内置 dsh 的启动参数

`server.js` 启动内置 dsh 时固定带 `--expose-internals`。
web profile 默认 `patchReload: "live"`，会加载 `cordis-plugin-hmr`，
而该插件要求 Node 以 `--expose-internals` 启动，否则插件树加载失败、
进程在约 40 秒后退出（**期间端口是 LISTENING 的，很容易被误判为正常**）。

> Windows 上如果构建被安全软件/沙箱拦截，需要允许大量文件写入。
> 构建产物在 `out-<时间戳>/`（解包版）和 `dist-<时间戳>/`（安装包）。

### 排查工具

| 脚本 | 用途 |
|---|---|
| `scripts/blackbox-test.py` | 黑盒测试套件（冷启动/单实例/端口冲突/退出清理等 8 项） |
| `scripts/verify-dsh-runtime.py` | 验证某份 dsh 运行时是否真正可用 |
| `scripts/verify-installed-app.py` | 端到端验证已安装应用（`--dev` 可验证开发模式） |
| `scripts/check-node-modules-integrity.py` | 查残缺包 |
| `scripts/repair-node-modules.py` | 定点修复残缺包（从 registry 拉原包补齐） |
| `scripts/check-skeleton.py` | 查骨架图标是否写入 |
| `scripts/verify-bundle.mjs` | 校验依赖闭包完整性 |
| `scripts/stage-dsh-runtime.py` | 多线程投放依赖（extraResources 失败时的回退） |

### 已知坑：孤儿锁

dsh 的跨进程锁（`$DSH_HOME/**/*.lock`）**设计上不自动清理**——
源码注释写明「orphan recovery is an operator action」。
任何一次 dsh 异常退出（崩溃 / 强杀 / 断电）都会留下永久锁，
之后启动会报 `atomic-write: timed out waiting for the writer lock`。
**处理**：确认没有 dsh 进程在跑之后，删掉 `~/.dsh` 下的 `*.lock`。

**源码运行**：要求 Windows 10/11 + Node.js 18+

```bat
cd dsh-browser
npm install   rem 首次安装 Electron（国内可先设 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）
npm start     rem 或直接双击 start-dsh-browser.cmd
```

源码运行方式需要本机已安装 DeepSeek Harness CLI（`npm i -g @deepseek-ai/dsh`），或在「设置 → 服务器 → 启动命令」中填写 dsh 路径。若项目 `node_modules` 里已有 `@deepseek-ai/dsh`，也会自动使用它（无需全局安装）。

默认连接 `http://127.0.0.1:3080`（DSH Web 默认端口）。若 Harness 跑在其他端口，在「设置 → 服务器」中修改。

> **启动速度提示**：安装版快捷方式（NSIS Setup 自动创建）指向 `AppData\Local\Programs\dsh-browser\` 下的独立 exe，1 秒左右出窗。开发调试可用 `dist\win-unpacked\DeepSeek Harness Browser.exe`（解压版，依赖该文件夹留在原地）。

## 快捷键

| 快捷键 | 功能 |
|---|---|
| Ctrl+T | 新建标签页 |
| Ctrl+W | 关闭标签页 |
| Ctrl+L | 聚焦地址栏 |
| Ctrl+R / F5 | 重新加载页面 |
| Ctrl+Shift+R | 强制重新加载 |
| Alt+← / Alt+→ | 后退 / 前进 |
| Alt+Home | 回到主页 |
| Ctrl+0 / Ctrl+= / Ctrl+- | 重置 / 放大 / 缩小 |
| F11 | 全屏 |
| F12 | 当前页开发者工具 |
| Ctrl+Shift+F12 | 浏览器界面开发者工具 |
| Ctrl+, | 打开设置 |

## 设置项

- **服务器**：主机、端口、自动启动、启动命令（默认 `dsh`）、工作目录、退出时是否停止服务、额外允许的主机（如局域网 IP）
- **外观**：界面主题（默认「跟随 DeepSeek Harness」——自动读取 Harness 的主题设置，Harness 切浅色/深色/跟随系统时浏览器壳实时同步；也可固定浅色或深色）
- **浏览**：允许在应用内打开外部链接（默认关闭，外部链接转系统浏览器）；恢复上次的标签页
- **窗口**：关闭时最小化到托盘、始终置顶

## 打包为单文件 exe（可选）

```bat
npm i -D electron-builder
npx electron-builder --win portable
```

产物在 `dist/`（便携版 exe，无需安装 Node.js）。

## 目录结构

```
dsh-browser/
├─ src/
│  ├─ main.js            # 主进程：窗口、菜单、托盘、导航策略、通知页协议
│  ├─ server.js          # dsh web 服务管理（探测/拉起/日志/健康检查）
│  ├─ nav-policy.js      # URL 分类与规范化（仅限 DSH 的导航策略）
│  ├─ settings.js        # 设置持久化（userData/settings.json）
│  ├─ preload-shell.cjs  # 外壳界面桥接
│  └─ preload-guest.cjs  # 标签页 guest 桥接（仅通知页生效）
├─ ui/
│  ├─ shell.html/css/js  # 浏览器 chrome（标题栏/标签页/工具栏/弹窗）
│  └─ notice.html        # 应用内通知页（连接失败/崩溃恢复）
├─ assets/icons/         # 由 DSH 官方 favicon 生成的应用图标
└─ scripts/              # 图标生成、CDP 调试辅助
```

本工具为 DeepSeek Harness 的配套桌面壳，与 Harness 官方项目无关。
