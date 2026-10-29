# dsh-sidebar-compact · 侧栏收纳

把侧栏「全局面板」收成一条：只留你想看的入口，其余全部收进侧栏的「更多」菜单。

默认只留「聊天」，插件、跨会话消息、自动化任务等都进「更多」；进哪个、留哪个在
**设置 → 侧栏收纳** 里逐个勾选，改完立即生效。

## 安装

DSH 插件市场（索引源 `doraasn/dsh-plugins-index`）搜索「侧栏收纳」，或直接装：

```
github:doraasn/dsh-sidebar-compact
```

## 使用

1. 打开 设置 → 侧栏收纳。
2. 勾选要留在侧栏的面板；取消勾选的会出现在侧栏「更多」里，点开照常切换。
3. 勾选结果保存在本机 `localStorage`（键 `dsh-sidebar-compact:keptPanels`），桌面端和网页端各自保存。

新装的面板默认收进「更多」，不会打断侧栏布局。

## 实现方式

- 菜单入口来自面板自己在 `sidebar.panellist` 的注册，图标直接复用同一个组件，不另画一套图形。
- 侧栏行按 `aria-label` 隐藏：面板增减、切换语言时会重新计算规则。
- 「更多」里的行挂在官方 `sidebar.panellist.actions` 槽位，点击走官方 `onOpen`，与原生入口行为一致。

## 兼容性

隐藏规则依赖侧栏的 `panelList` 类名片段与面板 `aria-label`。DSH 升级若改动这两处，
表现为入口重新出现在侧栏（静默失效，不影响使用），此时改 `client.js` 里的
`NAV_SELECTOR` 即可；面板列表、图标与勾选逻辑不依赖这些细节。

## 许可

MIT
