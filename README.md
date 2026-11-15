# DeepSeek Nativeness

**DeepSeek Nativeness** 是面向 macOS 的 DeepSeek Harness（`dsh`）原生桌面客户端与外壳应用，基于 Go + [MyGo](https://github.com/egoist/mygo) 原生 UI 与按需加载的 `WKWebView` 构建，在不修改后端协议与上游服务的前提下提供轻量、原生的桌面体验。

## 下载与安装

预编译的 macOS 发布包可直接从 GitHub Releases 下载：

- **下载地址**：[GitHub Releases](https://github.com/rkbkosp/deepseek-nativeness/releases)
- **系统要求**：macOS 15.8 及以上（Apple Silicon / Intel）

下载解压后将 **DeepSeek Nativeness.app** 拖入「应用程序」（`/Applications`）即可使用。发布包已内置原生可执行文件、Core Animation 运行态指示器动态库、独立 Node 运行时、Remote 通信桥接模块以及按需加载的兼容组件资源，无需额外配置开发环境。

## 核心特性

### 1. 原生远程客户端（Remote 模式）

- **端到端加密连接**：兼容 `ds-harness-remote`（`v0.6.4`）协议，使用固定的 `Noise_IK_25519_ChaChaPoly_SHA256` 套件进行端到端加密，按 `LAN -> P2P -> TURN -> Relay` 顺序自动协商传输路径，Host 无需开放公网端口。
- **原生对话与工作区界面**：
  - 使用 MyGo 原生绘制侧边栏、工作区列表、多会话管理与搜索。
  - 原生支持流式 Markdown 渲染、思考过程（Reasoning）与上下文（Context）折叠行、工具调用（Bash / Read / Edit / Search / Diff）详情行、过程分组（Process Groups）、子代理状态、Todo 面板与上下文统计。
  - 输入区支持多模态图片附件、队列（Queue）与插话（Steer）模式、斜杠命令、权限审批（Approval）及交互式提问（Questions）响应。
- **跨会话缓存与低延迟切换**：在客户端维护最近跟随会话的投影缓存与 Host 级能力/模型目录缓存，切换回已打开会话时无需重复拉取历史窗口。

### 2. 按需加载的兼容页（Ephemeral WKWebView）

对于低频或重度依赖原版复杂状态机的页面，客户端通过受控的本地 `WKWebView` 按需加载并复用上游组件：

- **支持路由**：插件管理（`plugins`）、模型选择器（`models` / `model-menu`）、执行轨迹时间线（`trajectory`）、远程终端（`terminal`）以及独立认证的 Remote Web 页面。
- **即用即毁**：仅在打开对应面板时创建 `WKWebView` 进程，并通过作用域票据（`clientScope` 与 `ownerId`）隔离流订阅；关闭面板或切换会话时立即销毁视图并释放全部后台流与内存。

### 3. 本地工作区模式（Local Runtime）

除了作为纯远程客户端连接远端 Host，应用还支持直接启动并托管本地 `dsh` 运行时：

- 可通过菜单栏 **「工作区 → 打开本地工作区」**（快捷键 `Cmd+Shift+L`）或启动参数 `--local` 进入本地工作区，使用 **`Cmd+Shift+N`** 随时返回原生界面。
- 自动校验并拉起内置的官方 `dsh` Host 运行时，在窗口内承载完整的本地工作区界面。
- 提供完整的桌面外壳体验：单实例锁、应用菜单、关闭窗口自动隐藏保活后台任务、点击 Dock 图标重新唤醒、退出前运行任务中断确认，以及 `dsh://` 登录回调深度链接支持。

### 4. 原生外观与合成层动效

- **Core Animation 运行态指示器**：保留原版 1.5 秒旋转周期与三次贝塞尔呼吸弧线，打包后通过 `libNativeDSHIndicators.dylib` 挂载至 AppKit/Core Animation 合成层并由窗口级对象池复用；静止等待期间不触发业务视图树重建或额外 Metal 帧渲染，同时遵循系统「减弱动态效果」（Reduce Motion）设置。
- **原生主题适配**：支持浅色、深色与跟随系统外观，集成 macOS 侧边栏毛玻璃（Vibrancy）与无边框内嵌标题栏。

## 数据隔离与安全边界

- **独立身份与偏好存储**：
  - Remote 设备身份与凭据存储在 `~/Library/Application Support/Native DSH/remote/<server-hash>/`。
  - 客户端界面偏好与连接配置存储在 `~/Library/Application Support/Native DSH Remote/preferences.json`。
- **零侵入设计**：Remote 模式绝不读取、迁移、刷新或覆盖本机 `~/.dsh` 目录下的已有凭据与配置。账号密码仅在登录时通过私有 stdio 管道传递给本地通信 helper，不会写入日志或落盘。
- **本地 Profile 锁保护**：在启动本地工作区（`--local`）前，客户端会主动检查 `~/.dsh` 的 desktop profile 占用状态；若原版桌面应用正在运行，将拒绝并发接管以保护本地数据安全。

## 本地开发与从源码构建

### 环境要求

- macOS 15.8 或更高版本
- Go 1.27.3+（使用 `CGO_ENABLED=0` 构建）
- Node.js 24.9+ 与 npm
- Xcode Command Line Tools（用于编译 Swift 原生指示器动态库）
- 与仓库同级放置的 [`mygo`](https://github.com/egoist/mygo) 源码目录（对应 `go.mod` 中的 `replace github.com/egoist/mygo => ../mygo`）

### 直接运行

在项目根目录下执行：

```sh
# 构建前端桥接与兼容层资源
npm ci --prefix remote && npm run --prefix remote build
npm ci --prefix compat && npm run --prefix compat build

# 启动原生客户端
CGO_ENABLED=0 go run .
```

### 打包 macOS `.app` 应用

```sh
sh scripts/build-app.sh
open "build/DeepSeek Nativeness.app"
```

如需将本机已安装官方客户端中的 `dsh` 运行时一并打包进 `.app`（以支持免外部依赖的 `--local` 本地工作区模式）：

```sh
node scripts/vendor-runtime.mjs
sh scripts/build-app.sh --with-runtime
```

### 界面回放与测试

`--demo` 模式仅用于本地 UI 与渲染回放，带有明显标识且不会启动 Remote helper 或建立任何网络连接：

```sh
# 启动本地界面回放模式
CGO_ENABLED=0 go run . --demo

# 运行 Go 单元测试与协议集成测试
CGO_ENABLED=0 go test ./...

# 运行 Remote helper 与兼容层测试
npm test --prefix remote
node --test compat/test/*.test.mjs

# 校验 Core Animation 原生指示器动态库 ABI 与生命周期
sh scripts/check-native-indicators.sh
```

## 目录结构与相关文档

- [remote/README.md](remote/README.md)：Node 侧 Remote 通信 helper、stdio 协议契约、会话缓存与安全边界说明
- [remote/CHAT_PRESENTATION.md](remote/CHAT_PRESENTATION.md)：原生对话页 Turn/Step 结构化投影契约
- [compat/README.md](compat/README.md)：按需加载的 `WKWebView` 兼容路由与组件复用说明
- `indicator_native/`：macOS Core Animation 运行态指示器原生实现（Swift）
- `runtime/` 与 `scripts/`：本地 `dsh` Host 启动器、应用打包、运行时提取与签名脚本
- [assets/NOTICE.md](assets/NOTICE.md)：应用图标与品牌矢量素材来源及开源许可说明

## 声明与许可

本项目复用上游开源组件的客户端协议与界面素材，相关许可详见 [assets/NOTICE.md](assets/NOTICE.md)、[assets/DSH-LICENSE](assets/DSH-LICENSE) 与 [remote/UPSTREAM-LICENSE](remote/UPSTREAM-LICENSE)。DeepSeek 及相关名称、图标与商标归其各自权利人所有。
