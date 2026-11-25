package main

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
)

type localizedText string

func (t *localizedText) UnmarshalJSON(data []byte) error {
	var s string
	if json.Unmarshal(data, &s) == nil {
		*t = localizedText(s)
		return nil
	}
	var m map[string]string
	if json.Unmarshal(data, &m) != nil {
		return nil
	}
	for _, key := range []string{"zh-CN", "zh", "en"} {
		if v := m[key]; v != "" {
			*t = localizedText(v)
			return nil
		}
	}
	for _, v := range m {
		*t = localizedText(v)
		break
	}
	return nil
}

type marketIndex struct {
	URL   string        `json:"url"`
	Title localizedText `json:"title"`
	Error string        `json:"error"`
}

type marketEntry struct {
	Name        string        `json:"name"`
	Title       localizedText `json:"title"`
	Description localizedText `json:"description"`
	Author      string        `json:"author"`
	Homepage    string        `json:"homepage"`
	Versions    []struct {
		Version string `json:"version"`
	} `json:"versions"`
}

type discoverState struct {
	Installing     string
	InstallErr     string
	Indexes        []marketIndex
	Entries        []marketEntry
	Query          string
	Loading        bool
	Error          string
	Selected       string
	IndexURL       string
	DetailMarkdown string
	DetailName     string
	DetailLoading  bool
	DetailError    string
	Category       string
	Categories     []marketCategory
	Labels         []marketCategory
	SelectedLabels map[string]bool
	Sort           string
	Offset         int
	NextOffset     int
	Total          int
}

type marketCategory struct {
	ID    string
	Title string
}

func (a *app) openDiscover() {
	a.discoverOpen = true
	if len(a.discover.Indexes) > 0 {
		return
	}
	go a.fetchDiscover("")
}

func (a *app) fetchDiscover(query string) {
	if a.client == nil || !a.connected || a.demo {
		a.discover.Error = "请先连接主机"
		return
	}
	client := a.client
	a.discover.Loading = true
	a.discover.Error = ""
	ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
	defer cancel()
	indexesRaw, err := client.Call(ctx, "pluginMarketIndexes", map[string]any{})
	if err != nil {
		a.update(func() { a.discover.Loading = false; a.discover.Error = "无法读取插件市场索引" })
		return
	}
	var indexes []marketIndex
	if json.Unmarshal(indexesRaw, &indexes) != nil {
		var wrapper struct {
			Indexes []marketIndex `json:"indexes"`
		}
		_ = json.Unmarshal(indexesRaw, &wrapper)
		indexes = wrapper.Indexes
	}
	sort.Slice(indexes, func(i, j int) bool { return indexes[i].URL < indexes[j].URL })
	a.update(func() { a.discover.Indexes = indexes; a.discover.IndexURL = indexes[0].URL })
	if len(indexes) == 0 {
		a.update(func() { a.discover.Loading = false })
		return
	}
	order := map[string]any{"kind": "relevance"}
	if a.discover.Sort == "published" {
		order = map[string]any{"kind": "published", "direction": "desc"}
	}
	offset := a.discover.Offset
	searchQuery := map[string]any{"text": query, "sort": order, "offset": offset, "limit": 40}
	if a.discover.Category != "" {
		searchQuery["category"] = a.discover.Category
	}
	if len(a.discover.SelectedLabels) > 0 {
		var labels []string
		for id := range a.discover.SelectedLabels {
			labels = append(labels, id)
		}
		sort.Strings(labels)
		searchQuery["labels"] = labels
	}
	params := map[string]any{"url": indexes[0].URL, "query": searchQuery}
	raw, err := client.Call(ctx, "searchPluginMarket", params)
	if err != nil {
		a.update(func() { a.discover.Loading = false; a.discover.Error = "搜索插件市场失败" })
		return
	}
	var result struct {
		Entries    []marketEntry `json:"entries"`
		Total      int           `json:"total"`
		NextOffset *int          `json:"nextOffset"`
		Metadata   struct {
			Categories map[string]struct {
				Title localizedText `json:"title"`
			} `json:"categories"`
			Labels map[string]struct {
				Title localizedText `json:"title"`
			} `json:"labels"`
		} `json:"metadata"`
	}
	if json.Unmarshal(raw, &result) != nil {
		a.update(func() { a.discover.Loading = false; a.discover.Error = "插件市场返回格式不正确" })
		return
	}
	a.update(func() {
		a.discover.Loading = false
		if offset > 0 {
			a.discover.Entries = append(a.discover.Entries, result.Entries...)
		} else {
			a.discover.Entries = result.Entries
		}
		a.discover.Total = result.Total
		a.discover.NextOffset = 0
		if result.NextOffset != nil {
			a.discover.NextOffset = *result.NextOffset
		}
		var categories []marketCategory
		for id, category := range result.Metadata.Categories {
			title := string(category.Title)
			if title == "" {
				title = id
			}
			categories = append(categories, marketCategory{ID: id, Title: title})
		}
		sort.Slice(categories, func(i, j int) bool { return categories[i].ID < categories[j].ID })
		a.discover.Categories = categories
		var labels []marketCategory
		for id, label := range result.Metadata.Labels {
			title := string(label.Title)
			if title == "" {
				title = id
			}
			labels = append(labels, marketCategory{ID: id, Title: title})
		}
		sort.Slice(labels, func(i, j int) bool { return labels[i].ID < labels[j].ID })
		a.discover.Labels = labels
	})
}

func (a *app) openDiscoverDetail(entry marketEntry) {
	if a.client == nil || a.discover.IndexURL == "" || len(entry.Versions) == 0 {
		return
	}
	client := a.client
	a.discover.DetailName = entry.Name
	a.discover.DetailLoading = true
	a.discover.DetailError = ""
	a.discover.DetailMarkdown = ""
	a.discoverDetailOpen = true
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
		defer cancel()
		raw, err := client.Call(ctx, "readPluginMarketEntry", map[string]any{
			"url": a.discover.IndexURL, "name": entry.Name, "version": entry.Versions[0].Version, "language": "zh",
		})
		a.update(func() {
			a.discover.DetailLoading = false
			if err != nil {
				a.discover.DetailError = "无法读取插件详情"
				return
			}
			var detail struct {
				Status   string `json:"status"`
				Markdown string `json:"markdown"`
			}
			if json.Unmarshal(raw, &detail) != nil || detail.Status != "found" {
				a.discover.DetailError = "这个版本没有可读的详情"
				return
			}
			a.discover.DetailMarkdown = detail.Markdown
		})
	}()
}

func (a *app) discoverDetailView(c *ui.Context) {
	if !a.discoverDetailOpen {
		return
	}
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(680).Height(600).Padding(18).Gap(10).Radius(16).Background(a.colors.Popup).Border(1, a.theme.Border).Children(func() {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				ui.Text(c, a.discover.DetailName).FontSize(16).FontWeight(500).Ellipsis("…")
				ui.Spacer(c)
				if ui.Button(c, "安装").Clicked() {
					a.discoverInstallName = a.discover.DetailName
					a.discoverInstallOpen = true
					open = false
				}
				if ui.ButtonBase(c).Size(24, 24).Label("关闭详情").Children(func() { icon(c, "close-outline", 14) }).Clicked() {
					open = false
				}
			})
			if a.discover.DetailLoading {
				ui.Text(c, "正在读取详情…").FontSize(12).TextColor(a.colors.Caption)
				return
			}
			if a.discover.DetailError != "" {
				ui.Text(c, a.discover.DetailError).FontSize(12).TextColor(a.colors.Caption)
				return
			}
			ui.Scroll(c.Key("discover-detail")).Grow(1).MinHeight(0).Clip().Children(func() {
				ui.Column(c).Padding(2, 6).Children(func() {
					markdown.View(c, a.discover.DetailMarkdown, &a.md)
				})
			})
		})
	})
	if !open {
		a.discoverDetailOpen = false
	}
}

func (a *app) installDiscoverEntry(name string) {
	if a.client == nil || !a.connected || name == "" {
		a.discover.InstallErr = "请先连接主机"
		return
	}
	client := a.client
	a.discover.Installing = name
	a.discover.InstallErr = ""
	go func() {
		ctx, cancel := context.WithTimeout(a.ctx, 90*time.Second)
		defer cancel()
		_, err := client.Call(ctx, "installBundle", map[string]any{"spec": name, "options": map[string]any{}})
		a.update(func() {
			a.discover.Installing = ""
			if err != nil {
				a.discover.InstallErr = "安装失败：" + err.Error()
				return
			}
			a.discoverInstallOpen = false
			a.copyNotice = "已安装 " + name
			a.fetchSchedules()
		})
	}()
}

func (a *app) discoverInstallView(c *ui.Context) {
	if !a.discoverInstallOpen || a.discoverInstallName == "" {
		return
	}
	open := true
	name := a.discoverInstallName
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(420).Padding(20).Gap(12).Children(func() {
			ui.Text(c, "安装插件").FontSize(16).FontWeight(500)
			ui.Text(c, name).Font(monoFont(a)).FontSize(12).Selectable()
			ui.Text(c, "安装会运行插件包的生命周期脚本。").FontSize(11).TextColor(a.colors.Caption).Wrap()
			if a.discover.InstallErr != "" {
				ui.Text(c, a.discover.InstallErr).FontSize(11).TextColor(a.theme.Danger).Wrap()
			}
			if a.discover.Installing != "" {
				ui.Text(c, "正在安装…").FontSize(11).TextColor(a.colors.Caption)
			}
			ui.Row(c).Justify(ui.End).Gap(8).Children(func() {
				if ui.Button(c, "取消").Clicked() {
					open = false
				}
				if ui.PrimaryButton(c, "安装").Disabled(a.discover.Installing != "").Clicked() {
					a.installDiscoverEntry(name)
				}
			})
		})
	})
	if !open {
		a.discoverInstallOpen = false
	}
}

func (a *app) discoverView(c *ui.Context) {
	if !a.discoverOpen {
		return
	}
	open := true
	ui.Modal(c, &open, func() {
		ui.Column(c).Width(660).Height(560).Padding(18).Gap(12).Radius(16).Background(a.colors.Popup).Border(1, a.theme.Border).Children(func() {
			ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
				ui.Text(c, "发现插件").FontSize(17).FontWeight(500)
				ui.Spacer(c)
				if ui.ButtonBase(c).Size(24, 24).Label("关闭发现").Children(func() { icon(c, "close-outline", 14) }).Clicked() {
					open = false
				}
			})
			input := ui.TextInput(c, &a.discover.Query).Placeholder("搜索插件名称、作者或关键词").Label("搜索插件市场").Height(34).AutoFocus()
			if input.Submitted() {
				a.discover.Offset = 0
				go a.fetchDiscover(a.discover.Query)
			}
			if a.discover.Loading {
				ui.Text(c, "正在读取插件市场…").FontSize(12).TextColor(a.colors.Caption)
				return
			}
			if a.discover.Error != "" {
				ui.Text(c, a.discover.Error).FontSize(12).TextColor(a.theme.Danger)
				return
			}
			if len(a.discover.Categories) > 0 {
				ui.Row(c).Gap(6).Wrap().Children(func() {
					if chip := ui.Button(c, "全部"); chip.Clicked() && a.discover.Category != "" {
						a.discover.Category = ""
						go a.fetchDiscover(a.discover.Query)
					}
					for _, category := range a.discover.Categories {
						category := category
						active := a.discover.Category == category.ID
						chip := ui.Button(c, category.Title)
						if active {
							chip.Background(a.colors.Selected)
						}
						if chip.Clicked() && !active {
							a.discover.Category = category.ID
							a.discover.Offset = 0
							go a.fetchDiscover(a.discover.Query)
						}
					}
				})
			}
			ui.Row(c).Gap(6).Wrap().AlignItems(ui.Center).Children(func() {
				shown := 0
				for _, label := range a.discover.Labels {
					if shown >= 8 {
						break
					}
					label := label
					shown++
					active := a.discover.SelectedLabels[label.ID]
					chip := ui.Button(c, label.Title)
					if active {
						chip.Background(a.colors.Selected)
					}
					if chip.Clicked() {
						if a.discover.SelectedLabels == nil {
							a.discover.SelectedLabels = map[string]bool{}
						}
						a.discover.SelectedLabels[label.ID] = !active
						go a.fetchDiscover(a.discover.Query)
					}
				}
				ui.Spacer(c)
				for _, option := range []struct{ id, title string }{{"relevance", "相关度"}, {"published", "最新"}} {
					option := option
					active := a.discover.Sort == option.id || a.discover.Sort == "" && option.id == "relevance"
					chip := ui.Button(c, option.title)
					if active {
						chip.Background(a.colors.Selected)
					}
					if chip.Clicked() && !active {
						a.discover.Sort = option.id
						go a.fetchDiscover(a.discover.Query)
					}
				}
			})
			if a.discover.NextOffset > 0 {
				if ui.Button(c, "加载更多").Clicked() {
					a.discover.Offset = a.discover.NextOffset
					go a.fetchDiscover(a.discover.Query)
				}
			}
			ui.Scroll(c.Key("discover-results")).Grow(1).MinHeight(0).Clip().Children(func() {
				ui.Column(c).FillWidth().Gap(2).Children(func() {
					for _, entry := range a.discover.Entries {
						entry := entry
						title := string(entry.Title)
						if title == "" {
							title = entry.Name
						}
						row := ui.ButtonBase(c.Key("discover:"+entry.Name)).FillWidth().Padding(8, 10).Radius(8).Gap(8).Justify(ui.Start).Label(title)
						row.Children(func() {
							icon(c, "plugin-pinwheel-outline", 16).TextColor(a.colors.Tertiary)
							ui.Column(c).Grow(1).Gap(2).Children(func() {
								ui.Text(c, title).FontSize(13)
								if text := string(entry.Description); text != "" {
									ui.Text(c, text).FontSize(11).TextColor(a.colors.Caption).SingleLine().Ellipsis("…")
								}
							})
							if len(entry.Versions) > 0 {
								ui.Text(c, entry.Versions[0].Version).FontSize(10).TextColor(a.colors.Caption)
							}
							install := ui.Button(c, "安装").Tooltip("安装 " + entry.Name)
							if install.Clicked() {
								a.discoverInstallName = entry.Name
								a.discoverInstallOpen = true
							}
						})
						if row.Clicked() {
							a.discover.Selected = entry.Name
							if len(entry.Versions) > 0 {
								a.openDiscoverDetail(entry)
							} else if strings.HasPrefix(entry.Homepage, "http") {
								a.openMarkdownLink(entry.Homepage)
							}
						}

					}
				})
			})
		})
	})
	if !open {
		a.discoverOpen = false
	}
}
