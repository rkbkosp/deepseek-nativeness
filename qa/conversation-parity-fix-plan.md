# 对话页 1:1 修复计划

依据：[conversation-page-parity-audit.md](conversation-page-parity-audit.md)（33 条差异，基线 `db92bfe`，会话页渲染文件自 `378b2bb` 后未变）。

目标不是“把所有差异一次改完”，而是按**可见收益 / 依赖 / 回归风险**分批，每一批都能独立提交、截图验收、失败可回滚。

---

## 0. 原则与约束

1. **先结构、后细节**：间距、行结构、尾部 chrome 决定“像不像”；颜色/圆角/图标是第二层。
2. **先原生、后 helper**：能在 Go 侧闭环的先做；活动组、统计、todo、retry/error 详情才动 helper。
3. **冻结引用不改**：`../deepseek-harness`、`../mygo` 只读。主题能表达的就改主题；主题表达不了的（行内代码 chip、hr 间距、KaTeX、shimmer）先列为“冻结限制”，不擅自 fork。
4. **每批一个提交/一组提交**：不把布局、颜色、工具重写混在一个 commit；每批附截图和测试。
5. **不做实时写验收**：只用 fixture、只读会话和已有截图；不发送、不审批、不取消真实任务。

---

## 1. 里程碑总表

| 里程碑 | 范围（审计 ID） | 主要文件 | 工作量 | 风险 | 依赖 |
|---|---|---|---|---|---|
| M0 基线/护栏 | 无（准备） | `qa/`、fixtures | 0.5d | 低 | — |
| M1 正文节奏 | A1、B2（block gap） | `conversation.go` | 0.5–1d | 低 | M0 |
| M2 主题/排版 | B1、B2、B3、B3.2（可主题化部分）、C2、C3 | `theme.go`、`markdown_actions.go` | 1–1.5d | 中 | M1 |
| M3 披露行 + 思考/上下文 | B4、B5 | 新 `disclosure.go`、`conversation.go` | 1.5–2d | 中 | M2 |
| M4 运行态/操作条/usage | A4、B6、B7（单轮） | `conversation.go`、`indicator.go`、assets | 1.5–2d | 中 | M1 |
| M5 工具行 | A3、A3.1、A3.2、A3.3 | 新 `tool_row.go`、`command_row.go` | 3–5d | 高 | M3 |
| M6 历史/滚动/导航 | A5、A6、C10（滚动部分） | `conversation.go`、`remote` 调用 | 2–3d | 中 | M1 |
| M7 输入区/队列/头部/Hero | B7.1、B8、B9、C1、C4（反馈）、C8、C9 | `composer*.go`、`conversation.go` | 2–3d | 中 | M2、M3 |
| M8 动效 + helper 扩展 | A2、B7（整会话）、B10、C10（动效） | `remote/`、`conversation.go` | 3–5d | 高 | M5 |

**建议执行顺序**：M0 → M1 → M2 → M4 → M3 → M5 → M6 → M7 → M8。  
M5 与 M6 可以并行（前者渲染层、后者列表/协议层）；M8 的 helper 设计应在 M5 开始前完成评审，避免工具行结构返工。

> 注意：下面章节按里程碑编号排列（M3 在 M4 前），实际执行顺序以上表为准 —— **M4 提到 M3 之前**，因为它只依赖 M1，且运行态/尾部操作条是最高频可见差异。

---

## 2. M0：基线与回归护栏（0.5d）

### 任务

- [ ] 固定基线提交，记录 `HEAD`、构建命令、Go/Node 版本。
- [ ] 建立 5 个固定查看状态：
  1. 已完成的多工具轮次（reasoning + bash + read + edit + search + web）；
  2. 运行中的轮次（含 reasoning/steering）；
  3. 空白会话 + 有队列；
  4. 失败/已停止/max-tokens；
  5. 含表格、代码块、公式、长链接的回复。
- [ ] 在现有 fixture 体系上扩展：`render_structured_fixture.go` 或 `qa/` 新 fixture，覆盖上述状态；不接真实 Host。
- [ ] 记录 1280×820 暗/亮两张基线截图，放入 `qa/`（私有截图不入库，仅本地对照）。
- [ ] 为纯函数加单测：行间距计算、reasoning 文本过滤、tail 判定、usage 格式化、command/tool 标题映射。
- [ ] 跑通 `CGO_ENABLED=0 go test ./...`、`npm test --prefix remote`、`node --test qa/...`。

### 验收

- 基线截图、测试命令、fixture 位置写入 `qa/conversation-fix-baseline.md`。
- 后续每批都能用同一 fixture 复现，不依赖真实会话。

---

## 3. M1：正文节奏（A1、B2 block gap）

### 实现

- [ ] `conversation.go:138-153`：`ui.List(...).Padding(28,32).Gap(24)` → `Padding(16,32).Gap(0)`。
- [ ] 新增纯函数 `chatRowGap(prev, current chatRow) float32`：
  - 第一行 0；
  - 前一行 `Control` → 16；
  - 当前或前一行是助手 response → 12；
  - 其余 → 4。
- [ ] 在列表项的 `ui.Column` 上加 `MarginTop(chatRowGap(...))`（只加一次，避免嵌套）。
- [ ] 行的 `Gap(12)` 按行类型调整：
  - 用户行 5（气泡/附件/操作条）；
  - 助手行 16（多 block 间距，对应原版 body gap）；
  - 过程行 0 或 4（由行间距统一控制）。
- [ ] 首行不额外加 margin；列表顶部 16，底部 16。
- [ ] 加单测：固定 6 行序列，断言 4/12/16 的组合；加截图对照。

### 验收

- 计算值：过程 4、response 12、控制器后 16、顶部 16。
- 多工具轮次的视觉高度与原版差值 < 1 行；无内容被裁切。

---

## 4. M2：主题与排版（B1、B2、B3、B3.2、C2、C3）

### 4.1 语义 token（C2）

- [ ] 在 `palette` 增加 `TextSecondary`、`TextTertiary`、`TextCaption`、`Bubble`、`CodeBlock`、`CodeBanner`、`HoverOverlay`。
- [ ] 暗色：tertiary `#ADB2B8`、caption `#81858C`、bubble `#2C2C2E`、code `#1B1B1C`、banner `#2C2C2E`。
- [ ] 亮色：tertiary `#81858C`、caption `#ADB2B8`、bubble `#EDF3FE`、code `#F9FAFB`。
- [ ] 把 `TextMuted` 的泛用拆成 tertiary/caption；避免所有次要文字一个灰。
- [ ] 自定义 disclosure 的 hover 改为文字色（M3）；在此之前不新增 SurfaceHover 填充用法。

### 4.2 用户气泡（B1）

- [ ] `Background(colors.Bubble)`、`Radius(20)`、`Padding(10,16)`。
- [ ] 最大宽度：`min(chatContentWidth*0.702, column*0.82)`。
- [ ] 用户动作条与气泡间距 6；附件/气泡间距 8；行高 22。
- [ ] 保持当前换行/选择行为。

### 4.3 字体与 Markdown（B2、C3）

- [ ] `md.LineHeight = (FontSize+10)/FontSize`（默认 24/14）。
- [ ] `md.BlockSpacing = 16/FontSize`。
- [ ] 标题：h1–h3 `Top/Bottom = 32/16`、h4–h6 `16/16`（按 `FontSize` 归一），h1–h3 权重 700。
- [ ] `md.Link = link token`、`md.LinkWeight = 500`、`md.ListIndent = 18/FontSize`、`md.ItemSpacing = 6/FontSize`、`md.QuoteBarWidth = 2`、`md.QuoteText = Text`、`md.QuoteBar = caption`、`md.TableCellPadding` 调整到 10/16（按字号归一）。
- [ ] 行内代码：把 `md.CodeBackground` 改为 inline-code token（亮 `#FAFAFA`、暗 `#292929`）；边框/圆角/padding 仍受 MyGo 限制。
- [ ] 代码块（`markdown_actions.go:149-192`）：
  - 圆角 16；背景 `CodeBlock`；banner 独立底色 `CodeBanner`；
  - banner padding `9px 14px`；body 左右 16；代码行高 19/11；
  - 语言色 primary；其余 toolbar 保持现有 wrap/copy 行为（原版默认 wrap=true）。
- [ ] 字体权重：A/B 对比 300 vs 400（同一 fixture、两主题），由验收决定；若保留 300，在报告中记录这是有意校准。

### 4.4 主题化不了的（冻结 MyGo）

- 行内代码的边框/圆角/padding、链接 hover 下划线、`hr` 的 32px 上下间距、KaTeX 排版、文字 shimmer：`mygo` 只读，主题不能表达。
- 处理：先做能做的（颜色、权重、列表/引用/表格/代码块），其余记录为“冻结限制”。不要在 M2 引入自定义 markdown 渲染器。

### 验收

- 用户气泡、代码块、灰阶、hover 与 token 表一致；标题/段落节奏与原版截图对齐。
- 生成一份“仍受 MyGo 限制”的清单（inline code、hr、KaTeX、shimmer），供后续决策。

---

## 5. M3：披露行基础 + 思考/上下文/压缩（B4、B5）

### 5.1 原生 DisclosureRow（基础组件）

- [ ] 新文件 `disclosure.go`：
  - 24px 行高、16px leading 盒、可选 14px 图标、13px/24 标题、2×2 圆点、13px 摘要；
  - 折叠时 hover 才显示 chevron，展开显示 chevron-up；hover 只改文字色（不使用 SurfaceHover 填充）；
  - 支持 `expanded`、`running`、`summary`、`disabled`、`Accessibility`；
  - 用 `Opacity`/`Animate` 实现 100ms 颜色过渡。
- [ ] 单测/渲染测试：行高、leading、hover 状态、展开内容。

### 5.2 思考行

- [ ] 标签改为“思考”；think 图标；摘要取首行/最新完成段落（去掉 `**`）。
- [ ] 移植 `reasoningText()` 到 Go：过滤 `<signature>`，空文本不渲染。
- [ ] 展开体用新的 `mdCompact`（13/20，BlockSpacing 4/FontSize，缩进 22）。
- [ ] 运行态：标题/摘要的 shimmer 先做“透明度呼吸”近似；完整渐变 shimmer 留 M8（需要自绘）。
- [ ] 折叠态高度 24；展开时标题 sticky（可用固定 header + 内容滚动）。

### 5.3 上下文/压缩

- [ ] 上下文标题角色化：上下文注入 / 跨会话召回 / 工具已更新；producer 作为次要信息。
- [ ] body 使用 compact 代码样式，最大 141px，内边距 10/16/12/12。
- [ ] 压缩：24px 行 + context 图标 + 标题；摘要计数需要 helper（当前只有文本），先按文本可用性降级。
- [ ] 工具增删类 context 的“工具已更新”摘要优先做（数据在 content blocks 里）。

### 验收

- 思考行 24px、图标/标题/摘要/签名过滤全部通过；上下文/压缩不再只是“标签 + 灰字”。
- 无 hover 整行填充。

---

## 6. M4：运行态、尾部操作条、usage（A4、B6、B7 单轮）

### 6.1 Tail 判定

- [ ] `chatRow` 增加 `Tail bool`；在 `presentedChatRows()` 组装时标出每轮最后一条可见非 process 行。
- [ ] 折叠策略变化、interleaved input、steering 场景补单测。

### 6.2 运行行

- [ ] 删除标题栏的 14px 转圈 +“运行中”（`conversation.go:40-43`）。
- [ ] 在列表末尾追加 synthetic running row：蓝色鲸鱼（新增 `assets/running-whale@2x.png` 或 SVG）+ 0.5px 分隔线 + `深度求索中，用时 X ···`（12px/22）。
- [ ] 计时来源：优先 `chatTurn.StartTime`，缺失时在 `Running` false→true 时记录；1 秒更新用 `c.After`，不做每帧业务重建。
- [ ] 尊重 Reduce Motion：无动画时静态鲸鱼。
- [ ] 停止但轮次未关闭时保留占位（隐藏文字，不塌陷）。

### 6.3 操作条

- [ ] 助手操作条只在 `Tail` 行渲染一次；中间回复不再生成操作条。用户消息仍逐条保留自己的操作条（原版如此）。
- [ ] 流式中不渲染；Turn 关闭后出现。
- [ ] 行高 28、图标 15（尾部 17）、时间 13（用户）/12（助手）；copy→feedback→branch→usage→time。
- [ ] 用户行时钟在 copy 前；日期感知格式（同日 HH:mm、同年 M月D日 HH:mm、跨年 Y年M月D日 HH:mm）。
- [ ] 非最新轮次：`data-actions-reveal` 等价行为——默认透明，行 hover/focus 显示；最新尾部常显。
- [ ] 分叉接 `forkSession {atSeq}`（客户端即可）；反馈按钮先保留禁用 tooltip，M7 再接反馈 API/对话框。

### 6.4 单轮 usage

- [ ] 解析 `message.usage`（`inputTokens/outputTokens/totalTokens/cacheReadTokens/...`）。
- [ ] 详细模式在 tail 操作条加 `用量 {formatTokens} tok` pill；简洁模式不显示。
- [ ] 只对最终 tail 的 usage 展示；多 attempt 的 turn 总量若 helper 不提供，先显示最终消息 usage并在注释中标明。

### 验收

- 运行态只在正文尾部出现；每个 turn 只有一条操作条；旧轮次 hover 显示；时间格式/图标尺寸与截图一致。

---

## 7. M5：工具行（A3、A3.1、A3.2、A3.3）

### 5a 通用工具行（先做，1–1.5d）

- [ ] 用 M3 的 DisclosureRow 替换 `ui.Collapsible`（`conversation.go:343-361`）。
- [ ] 工具名 → 标题/图标映射：
  - `bash/pwsh` 运行命令；`read/read_image` 读取/读取图片；`write` 写入；`edit/apply_patch` 编辑；`grep/glob` 搜索文件内容/查找文件；`web_search/web_fetch` 网页搜索/网页获取；`todo_write` 更新任务清单；`ask_user_question` 提问；`run_code/cua_run_code` 代码；其余“工具调用”。
- [ ] 摘要：从 `ArgsRaw` 提取 command/path/query/pattern；文件路径用可点击样式（先只显示，M5c 再接打开）。
- [ ] 错误用 `state-error` 色，不再在名字后拼“· 失败”。
- [ ] 默认不展示原始 JSON；需要时放在“输入”折叠区。
- [ ] 单测：每个工具名的标题/摘要映射。

### 5b bash + command（1–1.5d）

- [ ] bash：24px 行 + API 图标 + 运行命令 + 描述摘要 + shimmer/失败状态。
- [ ] 展开体（原生自绘，MyGo 无 TerminalBlock）：
  - cwd、命令行、stdout/stderr、exit code/signal；
  - 输出区最高 224px，内部滚动；复制按钮；
  - 背景 `CodeBlock`、圆角 16、代码字体 11/18。
- [ ] command 节点（`model.go:44` 已有 raw `command`）：
  - 新 `command_row.go`，解析 `{name,args,outcome}`；
  - 24px 行 + API 图标 + 命令名/“指令”+ 执行中/已完成/指令失败；
  - 展开 `<pre>` 输出，最大 260px，错误色。
- [ ] `/compact` 组合暂按普通 command 处理，等 helper 提供 compaction 计数再补。

### 5c 专用 body + 子调用（1.5–2d）

- [ ] `read/read_image`：路径 + 行号/高亮代码块（先做只读文本）。
- [ ] `write/edit/apply_patch`：路径 + `+/-` diff 统计 + 统一 diff 行色。
- [ ] `grep/glob`：pattern/路径摘要 + 匹配列表。
- [ ] `web_search/web_fetch`：query/URL + 结果列表/正文。
- [ ] `todo_write`：任务清单与进度。
- [ ] `ask_user_question`：问题/选项摘要。
- [ ] `subCalls`：嵌套缩进 22 + 8，按 `ToolCallTree` 的 4/2 间距递归渲染。
- [ ] 每类一个 fixture + 截图；无法精确复刻的 body 先给“信息完整”的简版，记录偏差。

### 验收

- bash/command 不再出现原始 JSON；所有工具都有可读标题/摘要；子调用可见；错误有语义色。

---

## 8. M6：历史、滚动、轮次导航（A5、A6、C10 滚动）

- [ ] 顶部“加载更早”行：读取 `hasMore`；调用 helper `history {beforeSeq,throughSeq}`；状态 `加载更早/正在加载/正在处理/重新加载/已到开头`。
- [ ] 加载后保持滚动位置：`ListState.Key` + `KeepOffset`；插入行不跳动。
- [ ] 回到底部按钮：34px 圆形、浮于输入卡上方 16px；`!following` 时显示。
- [ ] 轮次导航轨：右侧 28px 宽、每轮一个 mark；点击跳转/加载。
- [ ] 列表底部留白/滚动跟随：保持 `FollowEnd`，滚离后不强行拉回。
- [ ] 输入区底部渐隐与 sticky：如果 M7 不做，先确认列表底部硬边可接受。

### 验收

- 长会话（hasMore=true）能加载更早且位置稳定；滚上后出现回底按钮；轮次导航可见。

---

## 9. M7：输入区、队列、头部、Hero（B7.1、B8、B9、C1、C4 反馈、C8、C9）

### 9.1 队列/插话（B9）

- [ ] `inbox['next-step']`：在正文尾部渲染 pending steering 气泡（用户气泡复用），Host 接收后由 durable 消息替换。
- [ ] `next-turn` 队列卡改为贴附输入卡上沿：只圆上方两角、menu 背景、`5/8` 内边距、列表 180。
- [ ] 队列行补图片/文件缩略图；保留编辑/立即发送/移除。
- [ ] 单测：next-step 与 next-turn 不重复显示。

### 9.2 Hero（B8）

- [ ] 新增 fish 标志（从 DSH `FISH_LOGO_PATH` 生成 SVG 资源）与“探索未至之境”/“预览版”。
- [ ] 空白会话：Hero 居中 + 输入卡居中；隐藏标题/tab（与 `headerBlank` 一致）。
- [ ] 加载态：保留“载入历史…”轻量提示，不替换整个壳层。
- [ ] 更新 assets/NOTICE。

### 9.3 发送按钮 / 卡片（C9、C8）

- [ ] 发送/停止背景改为 info-fill token（#4176E6 / #7AAAFF）；sending 状态旋转弧。
- [ ] 输入卡圆角 28、发丝线 + shadow；宽度/顶部 8/间距 12 保持。
- [ ] 空白会话 placeholder 用 hero 文案。

### 9.4 头部（C1）

- [ ] 标题行 30px、header padding 10/28/0/20、下边线 0.5。
- [ ] 标题 220px 上限；预设标签补 `fill-tsp-secondary` 底色。
- [ ] 右侧顺序：utilities（暂空）→ 更多操作 → 右栏按钮；tab 间距 32。
- [ ] “更多视图”改为 tab 后的“更多会话视图”语义，不再用加号放文件/终端。

### 9.5 反馈 API/对话框（C4，客户端）

- [ ] `listFeedback` / `putFeedback` / `deleteFeedback` 接好点赞/点踩状态。
- [ ] 反馈对话框复用原版的 message/session 目标与提交/撤回收据；失败提示不吞。
- [ ] 与 M4 的 branch 一起做 tail 操作条的可用性验收。

### 9.6 Todo 面板（B7.1，需 helper）

- [ ] helper 提供 todos 投影后再做；输入卡上方 6/12 面板、标题 13/24、进度 13/20。
- [ ] 在此之前不做假数据。

---

## 10. M8：动效 + helper 扩展（A2、B7 整会话、B10、C10 动效）

### 10.1 Helper 扩展（单独设计评审）

- [ ] 活动组：利用 `processActivity` / `ProcessActivitySummary`，在 presentation 中增加：
  - 每组锚点、活动类型、计数、closed/live 状态、组标题所需分类；
  - 原生按组头 + 4px 行距 + 最大 400px 滚动渲染。
- [ ] `sessionStats` / `tokenUsage` / `contextOccupancy`：确认 `session/projections` 是否已包含；包含则原生解析，不包含则 helper 扩展。
- [ ] todo 投影（B7.1）。
- [ ] retry/turn-error/turn-trigger/max-tokens 的可显示字段（B10）。
- [ ] 每个 helper 扩展都有 fixture + 兼容性测试；不得改变已有字段语义。

### 10.2 动效

- [ ] 折叠：行 margin/透明度 160ms；turn 组高度过渡；`prefers-reduced-motion` 时关闭。
- [ ] 运行行入场 140ms；通知/队列卡入场按原版曲线。
- [ ] 输入区底部 36px 渐隐（自绘渐变或背景层）；先做静态渐变，再做滚动叠加。
- [ ] 文字 shimmer / KaTeX 若决定做，单独立项（受 MyGo 限制）。

---

## 11. 冻结限制与决策项

| 项 | 影响 | 选项 |
|---|---|---|
| 行内代码 chip（边框/圆角/padding） | 视觉 | A. 接受 tint 近似；B. 原生自写 markdown 渲染器（大）；C. 改 MyGo（不允许） |
| `hr` 32px 间距 | 视觉节奏 | A. 接受 3.5/11.9；B. 自写渲染器 |
| 链接 hover 下划线/命中区 | 交互 | A. 接受 500 权重和颜色；B. 自写渲染器 |
| KaTeX 公式 | 内容 | A. 保留原始 TeX；B. WKWebView 逐公式渲染（重、异步）；C. 引入 Go TeX 渲染器 |
| 文字 shimmer | 动效 | A. 透明度呼吸近似；B. 自绘渐变（M8） |
| 活动组摘要/统计/todo/错误详情 | 功能 | helper 扩展（M8），在此之前不做假数据 |

建议：第一轮 1:1 先接受 A，先把结构/间距/token/工具行做到位；是否为了这 5 项引入自定义 markdown 渲染器，单独决策。

---

## 12. 验证与提交

### 每个里程碑的 DoD

1. 代码 + 单测/fixture 测试通过；
2. 1280×820 暗/亮截图各一张，和基线并排；
3. 不改变未涉及区域；现有 `go test ./...`、`npm test --prefix remote` 全绿；
4. 不新增真实 Remote 写操作；
5. 提交信息单一句子，说明关闭的审计 ID。

### 推荐提交拆分

1. `chat: apply original flow spacing`（M1）
2. `chat: align core theme and message typography`（M2）
3. `chat: move running status to transcript and tail actions`（M4）
4. `chat: add native disclosure, thinking and context rows`（M3）
5. `chat: render tool rows with native summaries`（M5a）
6. `chat: add bash and command cards`（M5b）
7. `chat: add specialized tool bodies and subcalls`（M5c）
8. `chat: load older history and add turn navigation`（M6）
9. `composer: attach queue, hero and send chrome`（M7）
10. `remote: expose process groups, stats and edge-state fields`（M8）

### 首批三个提交（如果只做一周）

M1 + M2 + M4：先把“间距、token、气泡/代码块、运行态/尾部操作条”做对。这三批不改 helper、不碰工具协议，风险最低，整页视觉提升最大；随后用 M3 打披露行基础，再进入 M5 工具行。

---

## 13. 风险

- **仓库并行改动**：审计期间仓库已多次前进；每批开始前 rebase/确认页面文件未变，避免行号和结构冲突。
- **MyGo 限制**：行内代码/hr/链接/公式/shimmer 不能靠主题解决；提前和需求方确认接受近似，避免做到一半返工。
- **helper 协议**：活动组/统计/todo/错误详情扩展会影响 Remote 帧；需要独立评审、兼容旧客户端，不能和原生 UI 混在一个提交。
- **动画性能**：运行计时/shimmer 必须遵守 paint-only 调度，不能引入每帧业务重建。
- **验收偏差**：截图受主题、字号、Retina 缩放影响；固定 1280×820、默认字号 14、暗/亮两套，先量化再目测。

---

## 14. 实施状态（commit `3483889`）

| 里程碑 | 状态 | 落地内容 / 残余 |
|---|---|---|
| M0 | ✅ | `qa/conversation-fix-baseline.md`、固定 fixture 测试、全量 Go/remote 测试 |
| M1 | ✅ | 4/12/16 行距、顶部 16、助手 block gap 16、气泡 20/10/16 + 70.2% 上限 |
| M2 | ✅ 大部分 | 语义 token、代码块 16/底色/banner/19 行高、标题 700/32-16、链接 500、列表/引用、发送按钮、输入卡 28 |
| M3 | ✅ | 24px DisclosureRow、思考标题/图标/摘要/签名过滤、上下文角色标题、compact Markdown |
| M4 | ✅ | 正文运行行（鲸鱼+用时）、尾部唯一操作条、hover 显隐、用户时钟顺序/日期格式、单轮 usage |
| M5 | ✅ 大部分 | 工具标题/摘要/图标/错误色、bash TerminalBlock、command 卡、diff 卡、IN/OUT 卡、子调用递归 |
| M6 | ✅ | 加载更早、位置保持、`adoptHistorySnapshot`、回到底部、轮次轨、底部渐隐 |
| M7 | ✅ 大部分 | Hero/居中输入、队列贴附+附件标签、pending steering、发送色、头部 30px/32 间距、反馈对话框 |
| M8 | ✅ 原生侧 | 活动组头+折叠、Todo 面板、TurnTrigger 卡、Retry 行、轮/步+tok/s+token/缓存/上下文统计、错误/上限 notice、底部渐隐；顶部模式/子智能体/后台任务/终端 chips |
| 残余（MyGo 冻结） | ⏳ | 行内代码 chip、hr 32px、链接 hover 下划线、KaTeX、文字 shimmer；表格已由 `markdownBlock` 自定义，不在此列 |

全量：`GOCACHE=/tmp/dsh-go-cache CGO_ENABLED=0 go test ./...` 通过；`npm test --prefix remote` 73 项通过。
