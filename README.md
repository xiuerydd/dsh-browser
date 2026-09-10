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

构建安装包（两段式，推荐）：

```bash
npm install                # 首次：安装 electron / electron-builder / @deepseek-ai/dsh
bash build-installer.sh    # 出应用骨架 + 投放完整依赖 + 生成 NSIS 安装包
```

之所以分两段：dsh 的依赖闭包有 400+ 个包、8000+ 个文件，其中大量依赖声明在
`peerDependencies` 里。electron-builder 的依赖收集器**只沿 `dependencies` 链递归**，
会静默漏掉这些包（构建成功但运行时报 `ERROR_MODULE_NOT_FOUND`），所以改用
`extraResources` 把整个 `node_modules` 作为资源目录投放，再走 `--prepackaged` 出包。

脚本做的事：

1. `electron-builder --win --dir` 出应用骨架（含 `app.asar`）
2. `python scripts/stage-dsh-runtime.py <win-unpacked>` 多线程投放完整 `node_modules`
   到 `resources/dsh-runtime/node_modules`
3. `node scripts/verify-bundle.mjs <路径>` 校验运行时闭包完整性（0 缺失才继续）
4. `electron-builder --win nsis --prepackaged <win-unpacked>` 生成安装包

> Windows 上如果构建被安全软件/沙箱拦截，需要允许大量文件写入。
> 构建产物在 `out-<时间戳>/`（解包版）和 `dist-final/`（安装包）。

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
