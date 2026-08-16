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

要求：Windows 10/11 + Node.js 18+

```bat
cd dsh-browser
npm install   rem 首次安装 Electron（国内可先设 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）
npm start     rem 或直接双击 start-dsh-browser.cmd
```

默认连接 `http://127.0.0.1:3080`（DSH Web 默认端口）。若 Harness 跑在其他端口，在「设置 → 服务器」中修改。

> **启动速度提示**：桌面快捷方式请指向 `dist\win-unpacked\DeepSeek Harness Browser.exe`（解压版，1 秒左右出窗）。便携版 exe（`dist\DeepSeek Harness Browser 0.1.0-rc.6.exe`）每次启动都要解压到临时目录、且会被杀软逐文件扫描，启动可能慢达数十秒，仅作分发备份保留。注意：解压版依赖 `win-unpacked` 文件夹留在原地，移动项目目录后需重建快捷方式。

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
