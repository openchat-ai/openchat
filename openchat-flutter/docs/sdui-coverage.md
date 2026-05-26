# SDUI 覆盖矩阵

> 每个页面可远程改动的范围。✅=全SDUI、🟡=部分SDUI、❌=纯Dart

| 页面 | 外壳 | 布局 | 按钮/图标 | 文字 | 数据列表 | 逻辑 |
|------|------|------|----------|------|---------|------|
| **voice_room** | 🟡 背景色 | ✅ | ✅ | ✅ | — | ❌ |
| **settings** | 🟡 AppBar | ✅ | ✅ | ✅ | — | ❌ |
| **people** | 🟡 AppBar | ✅ | ✅ | ✅ | ✅ | ❌ |
| **chat_list** | 🟡 AppBar | ✅ | ✅ | ✅ | ❌ | ❌ |
| **home** | 🟡 AppBar | 🟡 for_each | ❌ | 🟡 标题/空状态/类型颜色 | 🟡 via for_each | ❌ |
| **agent_hub** | 🟡 外壳 | 🟡 for_each | ❌ | 🟡 标题/统计标签/弹窗/空状态 | 🟡 via for_each | ❌ |
| **theme_selector** | ✅ 外壳 | ✅ for_each | 🟡 颜色 | 🟡 标题 | ✅ via for_each | ❌ |
| **chat** | 🟡 标题 | 🟡 for_each | 🟡 气泡颜色/圆角 | 🟡 输入占位 | 🟡 via for_each | ❌ |
| **task_detail** | 🟡 标题 | 🟡 状态/信息项 | ❌ | 🟡 标题/状态/信息标签 | 🟡 statusItems/infoItems | ❌ |
| **dev_ide** | ✅ 外壳 | ✅ 标签栏 | ❌ | ✅ 标题/标签 | ❌ | ❌ |
| **resident_detail** | ✅ 外壳+标签 | 🟡 5子模块组件化 | ❌ | 🟡 标题/标签 | 🟡 子模块数据 | ❌ |
| **main_shell** | 🟡 FAB | 🟡 导航栏标签 | 🟡 导航栏图标 | 🟡 FAB 图标/动作 | ❌ | ❌ |

### 配置文件

所有页面优先读取 `oc/config/ui_app.json` 合并文件中的对应段落，也支持独立文件覆盖。

### 图例

- **外壳** — Scaffold背景色、SafeArea、AppBar标题
- **布局** — Column/Row/Spacing 等结构
- **按钮/图标** — `ui_room_sdui.json` 中按钮的 icon/color/size/action
- **文字** — 页面标题、状态文字、标签
- **数据列表** — 列表项的内容和样式（feed、residents、消息）
- **逻辑** — 按钮动作、状态机、音频管线

### 行动指南

| 你想做什么 | 改哪个文件 | 需要编译？ |
|-----------|-----------|-----------|
| 改通话按钮颜色 | `ui_room_sdui.json` | ❌ 不 |
| 改设置页菜单项 | `ui_settings.json` | ❌ 不 |
| 改首页标题 | `ui_home.json` | ❌ 不 |
| 改AI居民页标题 | `ui_agent.json` | ❌ 不 |
| 改主题选择器标题 | `ui_theme_selector.json` | ❌ 不 |
| **改消息页面布局** | **—** | **✅ 需编译（chat_screen 未SDUI化）** |
| **改任务详情页** | **—** | **✅ 需编译** |
| **改代码编辑器** | **—** | **✅ 需编译** |
| **改AI居民详情页** | **—** | **✅ 需编译** |
