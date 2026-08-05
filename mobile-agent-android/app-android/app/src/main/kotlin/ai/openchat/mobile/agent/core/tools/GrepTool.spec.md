# GrepTool.spec

## 数据流
- `grep_local`: 解析 `path` 到沙箱根 → walkTopDown 遍历文件 → 逐行子串匹配 → 收集 `relpath:lineNo: line` → 超 50 条截断
- `grep_repo`: 构造引号查询 `"<pattern>" repo:o/r [path:dir]` → GET `/search/code`（Accept: text-match+json）→ 输出文件路径 + 首个 fragment（3 行）

## 接口签名
| tool | args | 说明 |
|------|------|------|
| grep_local | pattern (必填), path (可选目录) | 只读，仅沙箱，大小写敏感子串 |
| grep_repo | pattern (必填, >=3 字符), path (可选目录过滤) | 只读，仅默认分支 |

## 边界条件
- MAX_LOCAL_MATCHES = 50；MAX_FILE_BYTES = 512KB（更大文件跳过）；单行截断 200 字符
- MAX_REPO_ITEMS = 20 个文件；fragment 取 3 行 x 160 字符
- grep_local 在 Dispatchers.IO；grep_repo HTTP 超时 10s/20s
- 空 pattern 两者都拒绝；GitHub API 要求搜索词 >=3 字符
- 沙箱检查：归一化 root 在 baseDir 内；walkTopDown 只下钻不越界

## 文件清单
- `GrepTool.kt` — GrepLocalTool / GrepRepoTool / createGrepTools
- `AgentService.kt` — buildToolRegistry 注册（+1 import +1 行）
- `RolePrompts.kt` — Explorer/Worker 提示词加 grep 引导
- `test/.../GrepToolTest.kt` — 7 个单测（格式/过滤/越界/空pattern/大文件/短pattern）

## 不变量
- 两个工具均只读，不改文件系统或仓库，无需审批 checkpoint
- token 只出现在 Authorization header，不进输出/日志
- 工具名 grep_local / grep_repo 在 ToolRegistry 唯一
