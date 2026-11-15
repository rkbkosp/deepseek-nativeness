# Desktop 对话页 vs 原版 DSH 对话页：代码级差异审计

- 审计对象：`desktop/`（Go + MyGo 原生客户端）的会话页；原版为冻结参考 `deepseek-harness/packages/client/`（React 客户端）。
- 审计基线：`desktop` 当前 `HEAD db92bfe`（审计过程中仓库持续前进，已按最新代码复核；会话页渲染文件在 `378b2bb` 后未变，`app.go` 等非页面文件的行号已同步；`378b2bb` 修复了“加载会话时误闪连接页”的问题）。
- 审计方式：只读静态审计。逐条对照两边**实际运行路径**的渲染代码与 CSS/Theme 数值，并用仓库内已有的 GUI 证据截图（`/tmp/native-dsh-parity/01-original-chat.png`、`156-gui11-live-controller-visible.png`，均为同一会话）核对量级。
- 本轮**没有**启动 GUI、Remote helper 或任何会话操作；未验证实时流式、IME、拖动分栏等只在运行中出现的细节。
- 结论级别：以下差异是代码层可直接定位的；不是“感觉差不多”，而是数值/结构/功能上的确定差异。

> 复审补充：补上了“思考过程”与“运行命令/指令”两条的 1:1 对照（B4、B4.1）；第二轮又补了工具族/子调用（A3.3）、Markdown 元素（B3.2）、数学公式（B3.3）、排队/插话（B9）、边缘状态行（B10）、发送按钮（C9）、动效/底部渐隐（C10）。审计期间仓库前进到 `db92bfe`，会话页行号已按 `378b2bb`（其后再无页面渲染变更）复核，`378b2bb` 已修复的“加载时误闪连接页”从差异中移除。

---

## 0. 先确认哪条代码在跑

原生会话页当前走的是 helper 提供的 `chatPresentation` 投影路径，而不是旧的 message 分组路径：

```text
conversation()                                  desktop/conversation.go:95
└─ presentedChatRows()                          desktop/chat_presentation_rows.go:39
   ├─ turnControllerView()                      desktop/turn_controller.go:37
   ├─ processView()                             desktop/conversation.go:232
   │  └─ chatPartView() -> messagePartView...   desktop/chat_presentation_rows.go:37 / desktop/conversation.go:325
   └─ messageView()                             desktop/conversation.go:319
```

`conversation_rows.go:94` 的旧分组只在没有 `ChatPresentation` 时使用；本文指出的问题以 `ChatPresentation != nil` 的真实路径为准（个别问题同时存在于两条路径）。

---

## 1. 结论摘要（按视觉影响排序）

1. **正文节奏整体偏松**：原生所有流式行统一 24px 间距、顶部 28px；原版是 4px（过程行）/12px（回复）/16px（轮次控制器后），顶部 16px。
2. **过程内容的组织方式不同**：原生把一轮展开成“控制器 + 一串扁平 part”；原版是“控制器 + 若干可折叠活动组（组头有图标/摘要/实时文案/滚动上限）”。
3. **工具调用不是原版的样子**：原生是“工具名 + 原始 JSON 参数 + 结果文本”的灰色卡片；原版是 24px 工具行（图标、友好标题、命令/路径摘要、状态色）+ 专用内容体。`bash` 尤其明显：原版“运行命令”行带 TerminalBlock/退出码，原生只有 “bash + JSON”；slash 指令节点甚至落入普通助手文本。
4. **运行中状态位置错误**：原生只在标题栏加“运行中”和灰色转圈；原版在正文尾部显示蓝色鲸鱼 +“深度求索中，用时 X ···”，正文结构不因运行改变。
5. **缺功能而非样式**：`hasMore` 从未消费（无法加载更早）、没有“回到底部”、没有轮次导航、没有消息用量/底部统计、反馈与分叉按钮被写死为禁用。
6. **主题 token 有系统性偏差**：用户气泡、代码块、三级文字灰阶、hover 填充、正文字重（默认 300）都与原版不同；浅色主题的气泡/代码块尤其明显。
7. **空会话不是原版 Hero**：`378b2bb` 已修复“加载时误闪连接页”，但空会话仍是“这个会话还没有消息 + 底部输入框”，缺少原版的鱼形标志 +“探索未至之境”+ 居中输入框。
8. **头部是近似而非一致**：标题行 43px vs 30px，右侧控件顺序与“更多视图”语义不同，缺少原版的 utilities/corner 席位。

---

## 2. 差异总表

严重度：P0 = 每个会话都看得见 / 核心能力缺失；P1 = 常见状态下明显可见；P2 = 局部或打磨项。  
“修复层”：C = 只改原生；H+C = 需要 helper 投影补充字段后再改原生。

| ID | 区域 | 严重度 | 原生实现 | 原版实现 | 修复层 |
|---|---|---|---|---|---|
| A1 | 正文间距/留白 | P0 | `Padding(28,32).Gap(24)` | `padding:16px 32px`；流间距 4/12/16 | C |
| A2 | 轮次过程分组 | P0 | 扁平 part 行 | 活动组头 + 4px 组内行距 | H+C |
| A3 | 工具调用行 | P0 | 裸工具名 + JSON + 结果卡 | ToolRow + 专用 body | C/H+C |
| A3.1 | 运行命令（bash/pwsh） | P0 | “bash” + 原始 JSON + 结果文本 | “运行命令”行 + TerminalBlock/退出码/复制 | C |
| A3.2 | 指令节点（command） | P1 | 无分支，落入 assistant 文本 | 指令卡 + 状态 + 输出 | C |
| A3.3 | 其他工具族/子调用 | P1 | 原始名 + JSON；subCalls 未渲染 | 读取/编辑/搜索/网页/待办/提问专用行 + 嵌套子调用 | C/H+C |
| A4 | 运行中状态 | P0 | 头部“运行中”灰点 | 正文尾部鲸鱼 + 用时 shimmer | C |
| A5 | 加载更早 | P0 | `HasMore` 只存不用 | “加载更早/加载中/失败重试” | C |
| A6 | 轮次导航/回到底部 | P1 | 无 | 右侧轮次轨 + 回到底部按钮 | C |
| B1 | 用户气泡 | P1 | 圆角 16 / padding 12,18 / Subtle / 无 70.2% 上限 | 圆角 20 / 10,16 / bubble token / 70.2% 上限 | C |
| B2 | Markdown 节奏 | P1 | 行高 23.8；块距 11.9；标题 600 | 行高 24；块距 16；标题 700 | C |
| B3 | 代码块 | P1 | 圆角 12、Surface、无 banner 底色、22px 内边距、15.4 行高 | 圆角 16、code-block token、banner 分带、16px 内边距、19px 行高 | C |
| B3.1 | 表格 | P1 | 外框 + 竖线网格、14px、8.4/5.6 内边距 | 仅底横线、13px、10/16、宽表扩展 | C |
| B3.2 | 行内/块级 Markdown | P2 | 链接 300、行内代码无边框；引用文字变灰；hr 1px/3.5 | 链接 500；代码 chip；引用 primary；hr 0.5px/32 | C |
| B3.3 | 数学公式 | P2 | 原始 TeX（等宽、muted、横向滚动） | KaTeX 排版 | C |
| B4 | 推理行 | P1 | “思考过程”箭头折叠 + 纯文本 14 | “思考”24px 行 + 图标/摘要/shimmer + compact Markdown | C |
| B5 | 上下文注入/压缩 | P1 | 通用折叠 + 纯文本 | DisclosureRow 规格 + 结构化 body | C |
| B6 | 消息操作条 | P1 | 每条回复都有、常显、图标 14、时间 11 | 轮次尾部一条、旧轮次 hover 显示、图标 15/17、时间 13（用户）/12（助手） | C |
| B7 | 用量/统计 | P1 | 底部空 22px；无 usage pill | 3 个统计 pill + 单轮 usage pill | C（单轮）/H+C（整会话） |
| B7.1 | 计划/待办 dock | P2 | 无 todo 渲染 | 输入卡上方 TodoPanel 卡 | H+C |
| B8 | 空态/加载态 | P1 | 空会话说明文案 + 底部输入框（无 Hero） | Hero + 居中输入框 | C |
| B9 | 排队 / 插话 | P1 | 仅 next-turn 独立卡片；next-step 不渲染；无附件缩略图 | 贴附输入卡的 QueueDock + 正文 pending steering 气泡 | C |
| B10 | 边缘状态行 | P2 | 触发/重试/错误/上限无专用行 | TurnTrigger/ModelRetry/TurnError/MaxTokens 卡 | H+C |
| C1 | 头部 | P2 | 43px 标题行；顺序不同；加号“更多视图” | 30px 标题行；更多操作/工具/右栏顺序；“更多会话视图” | C |
| C2 | 主题 token | P1 | 灰阶/气泡/代码/hover 偏灰偏暗 | design-platform 语义 token | C |
| C3 | 字重/字号轴 | P1 | 正文/UI 默认 300（标题/加粗另设）；行高倍数 | 400；px delta | C |
| C4 | 交互能力 | P1 | 反馈/分叉禁用；@ 引用纯文本 | 已接 API/引用 chip/选择操作 | C |
| C5 | 审批/提问 | P2 | 输入框上方卡片 | 接管输入区面板 | C |
| C6 | 错误横幅 | P2 | 固定浅红条（暗色也浅红） | 正文内错误文本/对话框 | C |
| C7 | 本地化 | P2 | 强制中文 | 8 语言 | C |
| C8 | 输入卡片圆角/描边 | P2 | 圆角 24 + 0.5 边框、无阴影 | 圆角 28 + 描边发丝线 + elevation 阴影 | C |
| C9 | 发送按钮颜色 | P2 | `Accent`（#477BE2 / #5686FE） | `button-info-fill`（#4176E6 / #7AAAFF） | C |
| C10 | 动效 / 底部渐变 | P2 | 折叠用 200ms Clip；行出现/消失无过渡；无底部渐隐 | 160ms margin + 140ms running 入场；sticky 输入区 36px 渐变 | C |

---

## 3. 逐项细节

### A1. 正文容器的间距与留白（P0）

原生：

```go
// desktop/conversation.go:138-153
ui.List(...).Grow(1).MinHeight(0).Padding(28, 32).Gap(24)
```

- 行与行一律 24px；列表上/下 28px、左右 32px。
- 每行内部还有一个 `Gap(12)`（`conversation.go:141`），单子节点时不起作用，但多子节点时会再加一层。

原版：

```css
/* packages/client/ui-chat/src/client/chat/ChatView.module.css */
.scroll { padding: 16px calc(var(--dsh-composer-side-clearance) + 16px); } /* :32 */
/* 相邻行 */
margin-top: var(--dsh-chat-flow-gap, 4px);            /* :86 */
.flowItem[data-chat-group-part="response"] { --dsh-chat-flow-gap: 12px; } /* :91-93 */
[data-chat-flow-kind="turn-process"] + ... { --dsh-chat-flow-gap: 16px; } /* :140-143 */
```

具体差值：

| 场景 | 原生 | 原版 |
|---|---|---|
| 过程行（思考/工具/上下文）之间 | 24px | 4px |
| 助手回复与相邻行 | 24px | 12px |
| 轮次控制器与其后内容 | 24px | 16px |
| 正文顶部 | 28px | 16px |

影响：一轮里有 6 个工具行时，仅间距就多出约 120px；长会话整体高度和滚动位置都会明显偏离原版。这是“仍然不一样”最直接、最大面积的来源。

修复方向：不要用 `ui.List.Gap` 统一间距，改为按行类型在行内部加 `MarginTop`（4/12/16），列表 Gap 归零；顶部 padding 改 16。行类型可从 `chatRow`/`chatPartRef` 推导。

---

### A2. 一轮的过程内容没有“活动组”（P0，需 helper 配合）

原生在投影路径下：

```go
// desktop/conversation.go:232-238
func (a *app) processView(...) {
    if row.ProcessSpec != nil {
        for _, part := range row.Parts { a.chatPartView(c, part) }
        return
    }
```

`presentedChatRows()` 只生成三类行：`Control`、`Process`（每个 part 一行）、普通消息行（`chat_presentation_rows.go:241,279`）。没有“组”这一层。

原版有专门的组容器：

- `ChatGroupSeat.tsx`：组头（活动图标 + 14px 标题 + shimmer）、成员容器；
- `ChatGroupSeat.module.css:1-16`：组头 24px 行、16px leading、14px 字号；
- `ChatGroupSeat.module.css:120-135`：组体默认最高 `min(400px, 50vh)`，内部滚动，4px 行距；
- `step-process.ts`：组标题按活动类型合成（读取/搜索/编辑/命令/子任务/上下文…）；运行中的实时标题是“正在分析请求 / 准备运行命令 / 正在运行命令”等（`ui-chat/src/client/locale.ts:7,14,27`）。
- 默认策略 `stepGrouping: 'collapsed'`（`presentation-policy.ts:25-39`）：展开轮次后先看到的是折叠的组头，而不是全部工具行。

影响：这不仅是外观——原版展开一轮后是“按活动分组的摘要”，再逐组展开；原生一次性把全部工具/思考行铺开，长轮次会变成很长的流水账，且缺少“正在读取 xx”“准备调用工具”等实时组头。

修复方向：helper 的 presentation 里增加每个活动组的标识、类型、锚点和摘要（或原生侧按 step/tool 顺序做尽量接近的分组），原生新增组头视图与“组体最大高度 + 内部滚动”。

---

### A3. 工具调用被降级成“原始 JSON 卡”（P0）

原生（`conversation.go:343-361`）：

```go
label := t.Name                    // 原始名，如 figma_setup
if t.IsError { label += " · 失败" }
ui.Collapsible(c.Key(m.ID), label, ..., func() {
    ui.Column(...).Padding(10).Gap(8).Radius(8).Background(a.colors.Subtle).Children(func() {
        if t.ArgsRaw != "" { ui.Text(c, t.ArgsRaw).Font("SF Mono, Menlo").FontSize(12)... }
        ui.Text(c, m.Text).FontSize(a.uiPrefs.FontSize)...   // 原始结果文本
    })
})
```

原版：

- 24px DisclosureRow：16px 图标 + 13px 标题 + 2×2 分隔点 + 13px 摘要（`ui-tool/src/client/tool/components/ToolRow.module.css:36-55`）；
- 摘要按工具生成（命令、路径、查询、diff 统计等），文件路径是可点击链接；
- 展开体按工具类型分派：ReadBlock、DiffBlock、SearchBlock、WebBlock、CodeBlock、input/output 卡、question、terminal 等（`ToolRow.tsx:400-455`）；
- 失败状态通过 `data-state` 与颜色表达，而不是在名字后拼“· 失败”。

影响：DSH 会话里工具步骤占多数。原生把最有信息量的“做了什么”替换成“工具名 + 一坨 JSON”，这是与原版差距最大的单点之一。

修复方向：至少按 `tool.Name` 生成摘要（命令/路径/query/模式），参数用结构化排版而不是原始 JSON；错误用语义色；文件类结果给出可点击路径。完全对齐需要补齐各工具 view。

---

### A3.3 其他工具族与子调用（P1）

原版的工具行不是一张通用卡，而是按工具族分派（`ui-tool/src/client/apply.ts:12-21`）：

| 工具 | 标题（`ui-conversation/src/client/locales.ts:332-345`） | 行摘要/展开体 |
|---|---|---|
| `read` / `read_image` | 读取 / 读取图片 | 可点击路径 + ReadBlock（行号、语法高亮） |
| `write` / `edit` / `apply_patch` | 写入 / 编辑 / 编辑 | 路径 + diff 统计 + DiffBlock |
| `grep` / `glob` | 搜索文件内容 / 查找文件 | pattern/路径摘要 + SearchBlock |
| `web_search` / `web_fetch` | 网页搜索 / 网页获取 | query/URL + WebBlock |
| `todo_write` | 更新任务清单 | 进度摘要 + TodoRow |
| `ask_user_question` | 提问 | 问题摘要 + Question 卡 |
| `run_code` / `cua_run_code` | 代码 | 代码体 + IN/OUT |
| 其他 | 工具调用 | 通用摘要 + IN/OUT |

原生只有通用分支（`conversation.go:343-361`）：标签是原始 `tool.Name`（`read`、`grep`、`edit`、`web_fetch`…），展开是原始 JSON + 结果文本。也就是说上表每一行的标题、摘要、图标、body 都不在原版状态。

另外，原版 `ToolCallTree` 会递归渲染 `subCalls`，子调用缩进 22px、内边距 8px、间距 4/2（`ToolCallTree.tsx:95-115`、`ToolCallTree.module.css:9-10`）。原生 `toolNode.SubCalls` 只有结构体字段（`model.go:86`），没有任何读取点，嵌套子调用会丢失或被当成主调用结果。

---

### A4. 运行中状态：位置、图形、文案都不同（P0）

原生（`conversation.go:40-43`、`indicator.go:50-90`）：

- 在**标题栏**显示 14px 灰色旋转弧 + 12px“运行中”；
- 正文尾部没有任何运行行，也没有已用时长。

原版（`RunningStatus.tsx:44-58`、`ChatView.module.css:218-305`）：

- 正文尾部一行：蓝色鲸鱼图标（1.5s 动画）+ `深度求索中，用时 7秒 ···`（`locale.ts:100-101`），文字 `14px-2 = 12px`、行高 22；
- 上方 0.5px 分隔线，进入时轻微上浮；
- 标题栏没有“运行中”文字。

影响：运行中页面顶部会多出一个原版没有的状态区，同时正文尾部缺少最醒目的运行反馈；两种状态（运行/完成）的结构差异也和原版相反。

修复方向：移除头部运行块；在行列表末尾插入运行行（蓝鲸 + divider + 用时），并保持“会话已停止但轮次未关闭”时占位不闪动。

---

### A5. `hasMore` 未消费：无法加载更早历史（P0）

- 原生只保存标志：`model.go:131`、`incremental.go:199-206`；全仓库没有任何 `history` 调用或“加载更早”控件（`grep` 仅有兼容页的 `"history"` 白名单，`compat.go:84`）。
- helper 已提供 `history {beforeSeq,throughSeq}`（`remote/README.md`），原版在顶部渲染 `加载更早 / 正在加载 / 正在处理 / 重新加载 / 已到会话开头`（`ChatView.tsx:248-267`）。

影响：初始窗口之外的消息无法再读到；对长会话是功能缺失，不是样式问题。实际只读验收中出现过 `hasMore: true`（`qa/latest-results.json`），说明不是理论问题。

修复方向：列表顶部固定“加载更早”行；用 `Key` + `KeepOffset` 保持滚动位置（MyGo `ListState` 已支持），加载后不跳动。

---

### A6. 缺少“回到底部”和轮次导航（P1）

- 原版：`TurnNavigator`（右侧轮次轨，`ChatView.tsx:234`）、`toBottomSlot/toBottom`（`ChatView.tsx:302-310`，`ChatView.module.css:359-410`）。
- 原生：`a.list.FollowEnd = true`（`app.go:132`），只有“跟随到底部”的隐式行为，滚上去后没有回到尾部的按钮，也没有跳转到某一轮的入口。

影响：长会话中离开底部后只能手动滚回；原版右侧极细的轮次标记也属于页面视觉的一部分。

---

### B1. 用户消息气泡（P1）

原生（`conversation.go:362-372`）：

```go
ui.Column(c).MaxWidth(a.chatContentWidth(c)).Gap(5).Children(func() {
    a.messageImageGallery(c, m)
    ui.Text(c, m.Text)...Padding(12, 18).Radius(16).Background(a.colors.Subtle)
    a.messageActions(c, m, true)
})
```

原版（`ui-primitives/src/UserMessageBubble.module.css:1-10`、`MessageItem.module.css:3-20`）：

| 指标 | 原生 | 原版 |
|---|---|---|
| 圆角 | 16 | `--dsw-radius-xl` = 20 |
| 内边距 | 12 / 18 | 10 / 16 |
| 行高 | 未显式设置，用 MyGo 文本默认值 | 22px |
| 背景（暗） | `#232324` | `neutral-bluish-850` = `#2C2C2E` |
| 背景（亮） | `#F3F5F8` | `deepseek-50` = `#EDF3FE` |
| 最大宽度 | 满内容列 680 | `min(列宽 × 0.702, 82%)` |
| 附件/气泡间距 | 5 | 8（`userStack`）、6（`userRow` 与操作条） |

影响：长提示词原生会铺满整列，原版会停在约 477px（默认列宽）；浅色主题下原版是淡蓝气泡，原生是灰气泡；暗色下原生更黑一档。

---

### B2. 助手 Markdown 的排版节奏与字重（P1）

原生主题（`theme.go:88-109`）：

```go
md.LineHeight = 1.7          // 14px → 23.8
md.BlockSpacing = .85        // 14px → 11.9
for i, size := range []float32{21,19,18,14,14,14} {
    md.Headings[i].Size = size / 14
    md.Headings[i].Weight = 600
}
```

原版（`ui-theme/src/styles/gradient-shadow-text.css:56-100`、`ui-primitives/src/markdown/MarkdownText.module.css`）：

| 指标 | 原生 | 原版 |
|---|---|---|
| 正文行高 | 23.8 | `24px`（= size+10） |
| 块间距（段落） | 11.9 | `16px` |
| 同一助手消息的多个 block | 12（行内 `Gap(12)`，`conversation.go:141`） | 16（`AssistantMarkdown` body gap，推理分组内 4） |
| h1–h3 字重 | 600 | 700 |
| 标题上/下间距 | `1.4em / 0.55em` ≈ 19.6 / 7.7 | 32 / 16（h1–h3）、16 / 16（h4–h6） |
| 列表缩进 | `1.6em` = 22.4 | 18px |
| 列表项间距 | `0.25em` = 3.5 | 6px |
| 引用条 | 3px | 2px，左内边距 14 |
| 正文颜色 | 主题 Text | `label-primary` |
| 行高随字号 | 倍数（1.7×） | 像素增量（size+10） |

影响：默认字号下差距是“段落更紧、标题更贴”；用户把字号调大/调小后，行高与块距会进一步偏离（原版保持 10px leading 与固定 16px 块距）。标题 600 vs 700 在 21px 尺寸下肉眼可见更轻。

另外，原生把根节点和消息列都设为 `FontWeight(300)`（`app.go:171`、`theme.go:118-126`），原版正文是 400。原生注释称这是 14-DIP 下的栅格校准；如果用户仍觉得“字更细”，这里是首要嫌疑。

---

### B3. 代码块（P1）

原生自定义渲染（`markdown_actions.go:149-192`）：

- 圆角 12；背景 `a.theme.Surface`（暗 `#2C2C2E`，亮 `#F4F4F5`）；
- 没有独立的 banner 底色，标题与代码同一块背景；
- banner 内边距 `10 / 18 / 8 / 22`；语言 11px `TextMuted`；
- 正文内边距：左右各 22（`md.CodeBlockPadding = 22/14`，`theme.go:98`），MyGo body 自带 `0.25em ≈ 3.5` 顶部/22 底部，再叠加 `b.Body` 外边距上 `2.5`、下 `-2`，合计约 上 6 / 下 20 / 左右 22；
- 代码字号 11、行高 `1.4×11 = 15.4`；默认自动换行；
- 语法高亮用 MyGo `editor.DefaultTheme`（`theme.go:88` 未覆盖 `md.CodeColors`），不是原版 shiki 的 token 色板；除非两边做过逐色校准，同一段代码的 token 色会不同；
- 不识别 diff fence：`diff`/`patch` 代码块按普通代码渲染，原版会按行绘制增删色。

原版（`ui-primitives/src/markdown/CodeBlock.module.css:6-42,80`）：

- 圆角 16；背景 `--dsw-alias-markdown-code-block`（暗 `#1B1B1C`，亮 `#F9FAFB`）；
- banner 单独底色（暗 `#2C2C2E`，亮 `#F9FAFB`），padding `9px 14px`，语言 11px 主文字色；
- 正文 padding 16；代码 11px / 19px 行高；
- 无边框，banner sticky。

影响：暗色下原生代码块明显更“亮、更方、更挤”；浅色下偏灰而不是近白。长代码因为行高 15.4 vs 19，行数视觉密度差异明显。

---

### B3.1 表格（P1）

原生走 MyGo Markdown 的默认表格：

- 外框 `Border(1)` + 圆角 `0.3em ≈ 4.2` + 裁剪（`mygo/ui/markdown/table.go:66`）；
- 行上边框、列左边框都画（`table.go:78,100`），即**完整网格**；
- 单元格内边距 `0.6em / 0.4em ≈ 8.4 / 5.6`，字号继承正文 14；
- 宽表不会突破内容列。

原版（`ui-primitives/src/markdown/MarkdownText.module.css:199-290`）：

- 无外框、无竖线，只有单元格底部 0.5px 横线（表头 `border-l3`，内容 `border-l2`）；
- 单元格 13px/22，表头 500，padding `10px 16px`，第一列去掉左 padding、最后一列去掉右 padding；
- `md-table-wide`（≥4 列）会横向扩展到整个会话宽度，表格内部横向滚动。

影响：同一张表在原版是“无竖线的扁平表格”，原生是有外框和竖线的卡片式网格；字号和内边距也更大。原版截图里的“项目/值”表就是这种差异的直接例子。

---

### B3.2 行内与块级 Markdown 元素（P2）

除了段落节奏，几个高频元素的样式也不同：

| 元素 | 原生 | 原版 |
|---|---|---|
| 链接 | `Link` = Accent；未设 `LinkWeight`（`theme.go:88-110` 无赋值）→ 保持正文 300；无 hover 下划线/命中内边距 | link token；**500**；hover/focus 点状下划线；3px 透明命中内边距（`MarkdownText.module.css:58-104`） |
| 行内代码 | 0.875em + 7% 文字色底纹，无边框/圆角/padding（`spans.go:222-226`、`theme.go:120`） | 0.875em + inline-code token + 0.5px 边框 + 圆角 8 + `padding: 0 5px`（`MarkdownText.module.css:170-181`） |
| 引用 | 3px quote bar、左内边距 11.9、文字 `TextMuted`（`view.go:518`、`theme.go:126-127`） | 2px caption bar、左内边距 14、文字保持 primary（`MarkdownText.module.css:158-163`） |
| 分隔线 | 1px、自身 margin 上 3.5/下 0（`view.go:486-488`；相邻块距另计 11.9） | 0.5px、上下各 32px（`MarkdownText.module.css:150-156`） |
| 列表 | 缩进 22.4、项距 3.5、marker Muted（`theme.go:123-124`） | 缩进 18、项距 6、marker secondary（`MarkdownText.module.css:109-116`） |
| 任务框 | Accent | `label-secondary`（`MarkdownText.module.css:194`） |

影响：引用块在原生会整体变灰，而行内代码缺少原版的“chip”感；`---` 分隔线在原版是上下 32px 的留白节奏，原生只有 3.5px，页面呼吸感完全不同。

---

### B3.3 数学公式（P2）

原生：没有给 `markdown.Options` 设置 `Math` 钩子（`app.go:127-131` 只设置了 Reveal/Block/OnLink/CodeBlock/WrapCode），`MathBlock` 会走 MyGo 的兜底分支：横向滚动 + 等宽字体 + `TextMuted` 的**原始 TeX**（`mygo/ui/markdown/view.go:500-510`）。

原版：行内 `$...$` 和 `$$...$$`/```math 围栏都走 KaTeX 排版（`ui-primitives/src/markdown/katex.tsx`、`CodeBlock.tsx:463-464`）。

影响：含公式的助手回复在原版是排版后的数学式，原生显示原始 TeX 源码。对技术/数学类会话比较明显。

---

### B4. 思考过程行（P1）——逐项 1:1

原生（`conversation.go:385-389`、`398-402`）：

- MyGo `ui.Collapsible`：leading 是 16×16 的折叠箭头（不是图标），label 直接继承 14px；行高由 `Padding(4,0)` + 文本决定，不是固定 24px；
- 展开体是 `ui.Text` 14px `TextMuted` 的**纯文本**，不经过 Markdown；没有首行/段落摘要，没有 shimmer，没有 running 状态，没有 sticky header；

原版（`ReasoningRow.tsx:90-110`、`ReasoningRow.module.css:1-50`、`ReasoningContent.tsx:14-21`）：

| 项 | 原生 | 原版 |
|---|---|---|
| 标签 | 思考过程 | 思考（`message.think`） |
| leading | 16×16 折叠箭头 | 16px 盒子里的 14px think 图标；hover 才换成 chevron |
| 折叠行高 | 可变（padding 4 + 文本行高） | 固定 24px（`ReasoningRow.module.css:6-9`） |
| 标题 | 14px / TextMuted | 13px/24，tertiary |
| 摘要 | 无 | 首行；流式中为“最新完成段落”首行，去掉 `**`，13/20，shimmer |
| 预览策略 | 无 | 运行中始终预览；完成后 compact 不显示、standard/detailed/verbose 显示（`presentation-policy.ts:25-52`） |
| 展开体 | 纯文本 14px | Markdown compact：13/20，缩进 22，`padding: 4px 0 4px 22px`，sticky 标题 |
| 签名文本 | block 路径直接用 `b.Text`（`conversation.go:401`），未过滤 `<signature>` | 每行先过 `reasoningText()`；过滤后为空则不渲染（`ReasoningRow.tsx:64-72,86`） |
| 状态 | 无 | `data-state=running/ok`，运行时有 aria 状态与 shimmer |

影响：原版折叠时也能读出“思考到哪了”，并区分运行/完成；原生只有标题和一段灰字。MyGo `Collapsible` 的 hover 还会填充整行背景（见 C2），原版只变文字色。

---

### B4.1 运行命令（bash/PowerShell）与指令行（P0/P1）

这里有两个不同的原版行类型，原生都没有 1:1：

**1）`bash` / `pwsh` 工具行**

原生（`conversation.go:343-361`）：走通用工具分支，标签是原始 `tool.Name`（显示为 “bash”/“pwsh”），展开体是原始 `ArgsRaw` JSON + 结果文本的灰色卡片。

原版（`ui-tool/src/client/tool/toolviews/bash-sample.tsx:74-160`，已由 `apply.ts` 注册为 `bash` keyed 行）：

- 24px 行，API 图标，标题 **“运行命令”**（bash/pwsh 共用中文标题，`ui-conversation/src/client/locales.ts:334,344`）；
- 摘要来自 `description` 或命令摘要，运行/准备时整行 shimmer；失败时显示退出码/信号 badge（`ExitCodeBadge`、`terminalExitLabel`）；
- 展开是 `TerminalBlock`：cwd、命令行、stdout/stderr、exit code、running 状态、复制按钮，输出区最多约 224px 内部滚动；
- 后台/持久/spill 场景有 IN/OUT 卡兜底；另有 inspect 按钮。

**2）命令 / 指令节点（slash、permission、plan、compact 等）**

原生：helper 投影会发 `role:"command"`、`kind:"command"` 和 `command {name,args,outcome}`（`remote/projection.mjs:333-355`），但原生 `message.Command` 只是未解析的 `json.RawMessage`（`model.go:44`），而 `messagePartView` 的 switch **没有 command 分支**（`conversation.go:331-373`）——命令节点落入默认 assistant 分支，只把 `m.Text` 当 Markdown 渲染。结果是：没有“指令”行、没有执行中/已完成/失败、没有可展开输出，命令名和 outcome 全部丢失。

原版（`GenericCommandCard.tsx:26-80`）：24px 行，API 图标，标题为命令名或“指令”，摘要“执行中…/已完成/指令失败”或 outcome 文本，运行 shimmer；输出用 `<pre>` 展开（11/16，最大 260px，错误语义色）。`/compact` 还有 `CompactionCommandCard` 组合卡。

影响：运行命令是 DSH 会话里最高频的过程行之一。原生把“运行命令 + 终端输出/退出码”替换成“bash + JSON”，把命令节点退化成一段匿名文本——这正是“看起来不是复刻”的直接来源。

---

### B5. 上下文注入 / 压缩（P1）

原生（`conversation.go:332-342`）把两类都塞进一个通用折叠：

- 标签 = producer label /“已注入上下文”/“上下文压缩”；
- body = 一行 `Text(m.Text)`，14px muted，无结构、无高度上限。

原版的标题是“角色解析”的：上下文注入 / 跨会话召回 / 工具已更新，producer label 只是标题后的次要信息；原生把 producer label 直接当标题。

原版：

- 上下文注入：DisclosureRow + 上下文图标 + 标题“上下文注入”+ 圆点 + producer + 摘要；body 按 `form` 渲染（Markdown/代码/JSON），最大 141px，11px/16px 代码字体，圆角 12（`ContextInjectionRow.module.css:54-63`）。
- 压缩：24px 行 + context 图标 + 标题 + “已压缩 N 条 / M token”摘要，可展开 Markdown 摘要，展开时按钮 sticky（`CompactionItem.tsx`、`MessageItem.module.css:80-150`）。
- 工具增删类 context 还有专门摘要（“工具已更新”等）。

影响：原生只剩一个标签，信息密度和可读性都明显下降。

---

### B6. 消息操作条（P1）

原生（`conversation.go:459-475`）：

```go
ui.Row(...).Height(24).Gap(8)
copy(14px) + [like/dislike/branch 全部 Disabled] + time(11px)
```

对每条有 `Text` 的助手回复都渲染（`conversation.go:454-455`）。

原版（`MessageIconActions`、`TurnTailNodeView`）：

- 助手操作条只在**轮次尾部**出现一次（`TurnTailNodeView.tsx:64-84`），旧轮次或非尾部回复通过 `data-actions-reveal="hover"` 隐藏到 hover/focus（`MessageIconActions.module.css:37-60`）；
- 行高 28，图标 15（助手结尾 17）；时钟用户 13px、助手 12px（secondary−1）；
- 顺序：copy → feedback → branch → usage pill → time；
- 用户行是 time → copy（`clock="start"`），原生是 copy → time；
- 助手操作条属于 turn tail：与回复之间先是 16px 的 tail 间距、再是 4px 光学偏移，不是普通流间距；
- 用户/助手的时钟用日期感知格式：同日只显示 `HH:mm`，同年显示 `M月D日 HH:mm`，跨年显示 `Y年M月D日 HH:mm`（`message-chrome.ts:84-104`）；原生固定 `1月2日 15:04`。

另外，原生在助手文本仍在流式输出时就会渲染操作条；原版要等 Turn 关闭、tail 节点出现后才显示。

影响：默认 `foldedReplies=all` 时，原生会在每个中间回复下加一条操作行，形成原版没有的“复制/点赞/点踩/分叉/时间”噪声；图标和时间也偏小。反馈/分叉在协议上可用（`remote/README.md` 明确支持 `putFeedback`、`forkSession`），原生却写死禁用。

---

### B7. 单轮用量与底部统计（P1）

- 原生：`composer.go:105-108` 明确“保留原版 dock 行”，实际是一个空 22px 行；`message.Usage` 字段存在（`model.go:41`）但从未解析。
- 原版：
  - 助手轮次尾部在“详细”模式显示 `用量 95.6K tok` 的 pill（`TurnTailNodeView.tsx:74`，默认 `usageDetail=detailed`）；
  - 输入框下方三个统计 pill：“2轮 6步 · 166 tok/s”“179K tok · 缓存命中 83%”“上下文 3%”（`StatsPills.tsx`、`ContextMeter.tsx`），在截图里始终存在。

影响：底部整行空白是页面上很显眼的差异；单轮 usage 的数据已经在 payload 里，属于纯原生缺口。整会话统计可能需要 helper 增加投影（标 H+C）。

---

### B7.1 计划/待办 dock 卡（P2，需 helper 配合）

原版在输入卡上方有一个 `conversation.input.dock` 区域；当会话有 todo 时渲染 TodoPanel：圆角 16、`--dsw-specific-menu` 半透明底、面板阴影、`padding: 6px 12px`，标题 13/24 500，进度 13/20 tertiary（`TodoPanel.module.css:1-60`、`TodoPanel.tsx:65-108`、`ConversationContent.tsx:160-173`）。

原生：`composerState` 只解析 `plan` 的 active/pending 两个布尔值用于工具栏 chip（`composer_state.go:103,302`、`composer_toolbar.go:63-64`），没有任何 todo 条目/进度渲染，也没有这个 dock 卡。当前 helper 输出里也没有 todo 投影，所以标 H+C。

影响：有计划的会话里，原版输入区上方会多一张计划卡，原生没有，输入区整体矮一截，计划内容在页面上不可见。

---

### B8. 空会话 / 加载态（P1）

`HEAD 378b2bb` 已把“无连接 / 无会话 / 加载中 / 空会话”拆成四种占位（`conversation.go:105-131`、`175-189`）：加载中显示共享运行指示器 +“正在载入会话…”，空会话显示“这个会话还没有消息 / 在下方描述任务开始协作。”，连接 CTA 只在真正未连接时出现。审计早期版本（`f012465`）里“加载时闪连接页”的问题已修复，报告不再把它算作差异。

仍然不一致的是：

- 原版空白会话是 Hero：34px 鱼形标志 +“探索未至之境”+“预览版”徽标（`EmptyHero.tsx`、`HeroShell.module.css`、`ui-conversation/src/client/locales.ts:79-80`），输入框**居中**（`ConversationRoot.module.css` `.composerHero`）；原生仍是“标题 + 说明 + 底部输入框”。
- 原版“无会话”仍保留 Hero/输入区结构；原生是“选择或新建会话”的一段居中文字。
- 原版加载态是在对话列顶部显示“载入历史…”并保留壳层（`ChatView.tsx:232-236`）；原生是整页居中占位，替换掉整个 transcript。
- 原版空白会话会隐藏标题与 tab（`ConversationHeader.tsx:23-28` 的 `headerBlank`），原生仍保留完整头部。

影响：新建会话和切换会话时的页面形态仍与原版不同；原来的“连接页误闪”已不再是问题。

---

### B9. 排队消息与插话（P1）

**next-turn 队列**

原生在输入卡上方画一张独立卡片（`composer_queue.go:11-65`）：全圆角 16、`.5` 边框、`Popup` 底、`margin: 0 6 -3`、列表最高 200；只有文本或“包含附件的待发送消息”，不显示图片/文件缩略图；标题 12px。

原版 QueueDock（`QueueDock.module.css:3-33`）是**贴附在输入卡上沿**的面板：只圆上方两角、与输入卡共用一条边、半透明 menu 背景 + backdrop、列表最高 180；标题 13px/500；每行有图片缩略图、文件 chip、内联编辑器（`QueueDock.tsx:60-140`）。

**next-step 插话**

原版把 `inbox['next-step']` 中用户插话渲染成正文里的 pending steering 气泡（`ChatFlow.tsx:73-78`、`MessageItem.tsx:244` 的 `PendingSteeringBubble`），在 Host 接收前就能在对话尾部看到。

原生只读 `inbox['next-turn']`（`composer_queue.go:11`），全仓库没有 `next-step` 的渲染点；因此插话消息在提交后、持久化前不会出现在页面上，只可能在队列卡里显示（如果 Host 同时给了 next-turn）。

影响：排队区的形状、附件可见性和插话反馈都与原版不同，其中“插话暂时不可见”属于功能差异。

---

### B10. 边缘状态行：触发、重试、错误、上限（P2）

原版有四个专门的行/卡：

- **TurnTrigger**：0.5px 边框、圆角 20、`turn-trigger` 背景，header `padding 12px 16px`，图标 + 标题（“收到 GitHub 事件”“自动化任务”等）+ 时间 + chevron；展开 body 左 40/右 16/下 12，内容最高 240（`TurnTriggerNodeView.tsx:36-75`、`TurnTriggerNodeView.module.css:1-35`）。
- **ModelRetry**：`<details>` 行，状态文案带 shimmer，展开显示 delay 与 failure（`MessageItem.tsx:63-128`）。
- **TurnError**：红点 + “处理失败”标题 + message + code 行（`MessageItem.tsx:132-146`）。
- **MaxTokens**：警告点 + “达到 token 上限”+ 提示（`MessageItem.tsx:148-160`）。

原生：

- 触发来源（github/webhook/schedule/retry 等）在 helper 里大多被归成 `kind:"context"`（retry 且无 blocks 才是 `turn-trigger`，`remote/projection.mjs:264-272`），原生统一走通用上下文折叠，不是 TurnTrigger 卡；
- `llm/retry` 在 helper 里只重置 attempt（`remote/projection.mjs:201-206`），没有可见 retry 节点；
- 轮次失败只有控制器标签“处理失败”，没有错误详情/错误码；max-tokens 则只有一个普通的“已完成，用时 …”，没有原版的上限提示（`turn_controller.go:29-41`）。helper 当前只给 `endReasonKind`（`chat_presentation.go:29`）。

影响：这些状态不是日常每轮都有，但一旦出现，页面会缺少原版的明确归因信息。后两项需要 helper 增补字段，标 H+C。

---

### C1. 头部（P2）

原生（`conversation.go:19-92`）：

- 总高 76：标题行 **43** + 视图行 33；标题行顺序为 `[右栏切换][运行中][更多操作]`；
- 视图行末尾是加号“更多视图”，菜单里放的是“文件 / 终端”；
- header 下边线 1px；tab 间距 22；标题没有原版 crumb 的 220px 上限，长标题会占满整行；
- 预设标签 12px、TextMuted、无底色；标题行左内边距随侧栏变化。

原版：

- `min-height:76; padding:10px 28px 0 20px`；标题行 **30px**，tab strip 上边距 10、可视行 25（`ConversationRoot.module.css:23-29,65-...`）；
- 标题行是面包屑导航（根会话只有标题；多项时 4px 间距、220px 省略、祖先 tertiary、右侧渐隐 mask），之后是 header actions（含预设标签，12px + 浅底色 `fill-tsp-secondary`），右侧是 utilities（插件动作）+ “更多操作” + corner 席位（`ConversationSession.tsx:108-220`）；
- header 下边线 0.5px；tab 间距 32、tab strip 左缩进 8、可视行 25px（tab 组合盒 35px）；
- “更多会话视图”位于 tab 之后（省略号），不是标题行右端的加号；视图本身由注册表驱动；
- 右侧栏开关在原版是 far-right 的“打开右侧边栏”，原生把它放到了最左并换了图标。

影响：标题基线略有偏移，右上角控件组的内容/顺序/图标语义都不同；预设标签少了底色。

---

### C2. 主题 token 与 hover（P1）

| 用途 | 原生 | 原版（design-platform.css） |
|---|---|---|
| 暗色 tertiary 文字 | `#979DA6`（bluish-500） | `neutral-bluish-400` = `#ADB2B8` |
| 暗色 caption | 同一个 `#979DA6` | `neutral-bluish-600` = `#81858C` |
| 暗色 secondary | 同一个 `#979DA6` | `neutral-bluish-300` = `#CFD3D6` |
| 暗色用户气泡 | `#232324` | `#2C2C2E` |
| 暗色代码块 | `#2C2C2E` | 正文 `#1B1B1C`，banner `#2C2C2E` |
| 暗色 hover 填充 | `SurfaceHover #3B3B3E`（不透明） | `rgba(255,255,255,.08)`（叠在底色上） |
| 暗色 active 蓝 | `#5686FE` | `deepseek-400 #7AAAFF` |
| 亮色用户气泡 | `#F3F5F8` | `deepseek-50 #EDF3FE` |
| 亮色代码块 | `#F4F4F5` | `#F9FAFB` |
| 亮色主文字 | `#141518` | `#0F1115` |

关键点不是单个色差，而是原生把原版的三级灰阶压成了一个 `TextMuted`（`theme.go:77`），并把 `ui.Collapsible` 的 hover 背景设成不透明的 SurfaceHover（MyGo 默认），于是过程行 hover 会出现一整块深灰，而原版只把文字从 tertiary 提到 secondary。

影响：所有过程行、时间戳、次要标签的明暗层级都与原版不同；暗色下原生偏灰暗，亮色下气泡/代码块偏灰。

---

### C3. 字重与字号轴（P1）

- `app.go:171`、`theme.go:118-126`：根节点与消息列 `FontWeight(300)`；原版正文/下拉/按钮是 400。原生注释说明这是 14-DIP 校准；但如果用户看到“字变细”，这是直接原因。自定义字体时原生又回到 400，说明这条校准只对默认字体成立，跨字体不一致。
- 行高用倍数（`LineHeight=1.7`），原版用像素增量（`24px + (size-14)`）；块距用 em（0.85×size），原版固定 16px。字号一改，两边的节奏会越差越远。
- 原版所有行高/图标尺寸随 `--dsh-content-font-delta` 缩放（DisclosureRow 24+delta、动作 28+delta）；原生过程行是固定 MyGo 尺寸，不随设置字号变化。

---

### C4. 交互能力（P1）

代码层缺口，不是样式：

| 能力 | 原生 | 原版 |
|---|---|---|
| 消息反馈 | 按钮存在但 `Disabled(true)`（`conversation.go:468-469`） | feedback slot，真实调用（`ui-message-feedback`） |
| 分叉 | 按钮存在但 `Disabled(true)`（`conversation.go:470`） | `forkAt`，按 turn/end seq 切分 |
| 用户 @ 引用/文件/技能 chip | 纯文本 | `UserText` 解析 + `ReferenceChip`/HoverCard |
| 文本选择操作（引用/复制片段） | 仅可选择 | `useTextInteraction` + 操作浮层 |
| 非图片附件卡 | 无 | 240×64 文件卡（`MessageItem.module.css:325-...`） |

影响：这些在页面上表现为“有图标但点不了”或“该有 chip 的地方是纯文本”，属于可感知的功能差异。

---

### C5. 审批 / 提问（P2）

- 原生把 `Pending` 卡片放在输入框上方（`conversation.go:477-499`、`composer.go:26-34`），卡片是 12px 圆角、`Subtle` 底、普通按钮。
- 原版的审批/提问**接管输入区**（ChatView 注释明确：questions 与 approvals 都 takeover composer），有完整的面板标题、选项布局、键盘与请求身份展示。

影响：等待审批时页面结构与原版不同，输入框仍在但原版会被面板替换。

---

### C6. 全局错误横幅（P2）

原生 `app.go:192-198`：固定 `#fff1f1` 底 + `#b53a3a` 字，位于头部下方，暗色主题下也是浅红色横条。  
原版：打开错误在正文内以 `openError` 文本显示，文件打开失败是对话框；没有跨页的浅红横幅。

影响：暗色模式下一次网络错误就会出现刺眼的浅红色块，且把正文向下推；原版不会。

---

### C7. 本地化（P2）

`viewPreferences.Language`（`theme.go:24`）没有任何读取点；对话页所有文案（思考过程、运行中、执行过程、已完成、已停止、已注入上下文、错误信息等）都是硬编码中文。原版按 `locale.ts` 提供 8 种语言。用户切到英文/日文时，原生对话页保持中文。

---

### C8. 输入卡片的圆角、描边与阴影（P2）

原生（`composer.go:36`）：

```go
Padding(8, 0, 0).Gap(12).Radius(24).Border(.5, a.theme.Border).Background(a.colors.Composer)
```

原版（`InputBar.module.css:54-76`）：

- `border-radius: var(--dsw-radius-panel)` = **28px**；
- `border: 0`，用 `box-shadow: var(--dsw-elevation-soft)` + `--dsw-elevation-stroke-color: border-l2` 表达发丝边；
- 背景 `--dsw-specific-input-major`（暗色 = bluish-850 `#2C2C2E`，与原生一致；亮色 = 白色）；
- 顶部 8、间距 12、宽度一致。

影响：输入卡片是每页最大的一块控件，24 vs 28 的圆角与原版的柔和阴影/发丝边差在整页对比里可见；亮色下原版靠阴影浮起，原生靠实线边框。

---

### C9. 发送按钮的颜色与状态（P2）

原生发送/停止按钮都用 `a.theme.Accent`（`composer_toolbar.go:146,158`）：亮色 `#477BE2`、暗色 `#5686FE`（`theme.go:68,78`）。

原版用 `--dsw-alias-button-info-fill`（`InputBar.module.css:395-430`）：亮色 `deepseek-500 #4176E6`、暗色 `deepseek-400 #7AAAFF`；禁用时整体 0.4 透明，`sending` 时保持满色并换成旋转弧。

影响：暗色下原版是明显更亮的蓝（#7AAAFF），原生是偏深的 #5686FE；原版发送中会把箭头换成旋转弧并保持满色，原生没有 sending 状态，只会进入普通 busy/disabled。

---

### C10. 折叠动效与底部渐隐（P2）

- 原生只有单个 part 的 MyGo `Collapsible` 有 200ms Clip 动画（`mygo/ui/collapsible.go:38`）；轮次控制器的展开/收起直接改可见行集合（`turn_controller.go:18-28`），没有行距/透明度过渡，过程行会瞬间出现或消失。
- 原版在折叠时对 margin-top 做 160ms 过渡（`ChatView.module.css:112-120`），运行状态入场 140ms（`:176`），过程组高度/淡入也走同一套曲线。
- 原版输入区是 sticky 的，顶部有固定 36px 的 `bg-base` 渐隐带，transcript 从输入卡后面淡出（`ConversationRoot.module.css:516-549`），滚动条预留 stable gutter、2px 偏移；原生输入区是独立 sibling，列表在输入卡上方硬切，没有渐隐，列表底部到输入卡之间只有 28px padding。

影响：折叠一轮时原版是“平滑收拢”，原生是“整块消失”；滚动到底时原版有内容渐隐到输入区的过渡，原生是一个硬边。

---

## 4. 已经接近、不要误改的部分

避免“为差异而差异”，以下数值基本与原版一致，可作为对齐基准：

| 项 | 原生 | 原版 |
|---|---|---|
| 内容列宽公式 | `min(column-64, max(680, min(920, column*.64)))` | `clamp(680, 64%, 920)` + 滚动区 32px 侧边距 |
| 轮次控制器 | 高 `33+delta`、`padding 0 0 8`、0.5px 底边、14px 标签 | `TurnProcessNodeView.module.css:7-10` |
| 控制器文案 | 已完成 / 已完成，用时 X / 已停止 / 处理失败 | 同 |
| 停止标签 | 11/18、padding 0 6、圆角 8、语义底色 | `AssistantMarkdown.module.css:73-80` |
| 输入卡片几何 | 顶部 8、间距 12、最大宽 = 内容列+32 | `InputBar.module.css` `.card`；圆角/描边差异见 C8 |
| Tab 字号/选中条 | 13px、2px 底部条 | `ConversationRoot.module.css:260-296` |
| 预设标签文本 | 12px、图标 14、最大 180 | `AgentPresetLabel.module.css`（缺底色） |
| 标题字号 | 14 / 500 | crumb 14 / 500 |
| 图片圆角 | 20 | `--dsw-radius-xl` = 20 |

---

## 5. 建议修复顺序

1. **A1 间距**：改动小、全页可见，先把列表 Gap 改为 0 + 行内 4/12/16、顶部 16。
2. **A4 运行态 + B6 操作条**：把“运行中”从头部移到正文尾部；操作条只在轮次尾部渲染并按 hover 显隐；顺手接上 usage（`message.usage` 已有）。
3. **A5 历史加载 + A6 回底/轮次轨**：功能缺口，需要列表顶部/底部锚点与 `history` 调用。
4. **A3/A3.1/A3.2 工具与命令行 + B4/B5 过程行**：统一到 24px DisclosureRow 规格（图标 + 13px 标题 + 摘要），先补 bash 的“运行命令 + TerminalBlock”，再补 command 分支。
5. **B1/B2/B3/B3.1/B3.2/B3.3/C2/C3 主题与排版**：按 token 表逐项替换；先做用户气泡、代码块、灰阶、hover 填充、行内代码/引用/hr，再讨论 300/400 字重校准。
6. **A2 活动组**：需要 helper 增补组摘要字段；在此之前可先用“step 分界 + 工具类型”做近似组头。
7. **B7.1/B8/B9/B10/C1/C4-C10**：计划卡、Hero、排队/插话、边缘状态、头部席位、反馈/分叉、审批面板、错误样式、输入卡圆角、发送按钮、动效、本地化。

每步完成后用同一会话、1280×820、暗/亮两主题截图对照，并优先核对计算样式：
`-dsh-chat-flow-gap`、`.bubble`、`.running`、`.actions`、`.tab`、`.header`、代码块 `padding/background`。

---

## 6. 审计边界

- 本文的“原版”指冻结源码 `deepseek-harness` 的 React 客户端；不包含已安装 Desktop 应用可能注入的差异。
- 没有重新运行 GUI/Remote；GUI 证据来自仓库已有截图（同一会话的 2560×1640 原始/原生截图各一张）。截图只用于确认量级，不用于逐像素测量。
- 没有验证：实时流式中的组头/思考 shimmer、输入法、拖拽上传、窗口分栏拖动、M1/15.8 环境。
- 标 H+C 的项（活动组摘要、整会话统计）在当前冻结 helper 输出里没有直接字段；其余均为原生侧可独立修复。
- 本审计只读，未修改任何应用代码、配置或远端状态；审计期间仓库由 `f012465` 前进到 `db92bfe`；会话页行号按 `378b2bb` 复核（其后再无页面渲染变更），`378b2bb` 修复的加载占位问题已从差异列表移除。
