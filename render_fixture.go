package main

import "strings"

func renderFixture(kind string) string {
	text := strings.Repeat("A long local fixture paragraph. This content is simulated and does not read or contact a remote Host.\n\n", 150)
	if kind == "table" {
		text += "## 配套信息\n\n| 项目 | 值 |\n| --- | --- |\n| 运行模式 | 原生远程客户端 |\n| 版本 | 本地模拟 |\n| manifest | `/tmp/native-dsh-fixture/companion/manifest.json` |\n| 安装包 | `/tmp/native-dsh-fixture/paired.zip` |\n\n## 两个注意点\n\n- 本地 fixture 仅用于验证长文档与表格渲染。\n- 不包含真实会话内容和身份信息。\n\n"
	}
	if kind == "multi-table" {
		text += "## 多列横向阅读\n\n| 项目 | 值 | 描述 | 链接 |\n| --- | --- | --- | --- |\n| manifest | `/tmp/native-dsh-fixture/long-directory-name/companion/manifest-with-long-name.json` | 多列文档局限在会话区域，使用横向滚动阅读 | [说明](https://example.com/fixture) |\n\n"
	}
	return text + "完成本地渲染回归。"
}
