# 对话页修复基线（M0）

基线提交：`db92bfe`（会话页渲染文件自 `378b2bb` 后未变；审计期间仓库有并行运行时改动）。
验证环境：macOS / Apple M4，Go 1.27.4，Node 24.19，CGO disabled。

## 固定查看状态与 fixture

| 状态 | 覆盖内容 | 载体 |
|---|---|---|
| 完成的多工具轮次 | reasoning、tool、command、usage、tail actions | `tool_row_test.go`、`disclosure_test.go` |
| 运行中的轮次 | 运行行、无尾部操作条、滚动跟随 | `chat_tail_test.go` |
| 空白会话 | fish Hero、预览版徽标、居中输入卡 | `conversation_surfaces_test.go` |
| 历史加载 | “加载更早”行、同 baseline 快照合并 | `conversation_surfaces_test.go`、`chat_presentation_test.go` |
| 插话/队列 | pending steering 气泡、next-turn 队列 | `conversation_surfaces_test.go`、`composer_queue.go` |
| 触发/统计 | TurnTrigger 卡、轮/步、token、缓存命中 | `conversation_surfaces_test.go`、`stats.go` |
| 长历史虚拟化 | viewport-only part builds | `chat_virtualization_test.go` |
| 表格/代码/公式 | 主题、代码块、表格、公式兜底 | `render_structured_fixture_test.go`、`layout_test.go` |

## 命令

```sh
cd /Volumes/SuperDisk/native-dsh/desktop
GOCACHE=/tmp/dsh-go-cache CGO_ENABLED=0 go build ./...
GOCACHE=/tmp/dsh-go-cache CGO_ENABLED=0 go test ./... -count=1 -timeout=240s
npm test --prefix remote
npm run --prefix remote build
```

## 当前基线结论

- Go 全包测试通过；remote helper 73 项通过。
- 会话页结构、间距、运行行、尾部操作条、思考/上下文/工具/命令/触发行均有可断言的文本/尺寸测试。
- 受冻结 MyGo 限制、尚未 1:1 的项：行内代码 chip 的边框/圆角/padding、`hr` 的 32px 间距、链接 hover 下划线、KaTeX 排版、文字 shimmer。
- M8 helper 新增 `trigger` 与 `model-retry` 投影；活动组头、Todo、错误/上限 notice、Retry 行、轮/步/tok/s/token/缓存/上下文统计均由原生派生。顶部显示模式、子智能体数量、后台任务数量与终端入口。