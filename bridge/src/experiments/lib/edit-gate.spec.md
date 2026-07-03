# spec: lib/edit-gate.mjs — 编辑审查门
> Cursor 式内联 Diff + Accept/Reject 的确定性版：写工具落盘前 dry-run 出真实 diff

## 数据流
```
写工具 call → previewEdit(tool,args) 读文件+定位, 算 before/after（不落盘）
  → unifiedDiff(before,after) 彩色行级 diff
  → 用户 accept → applyEdit() = coding-lib.executeTool 落盘
  → 用户 reject → 丢弃, 文件不变
只读工具 isWriteTool()=false → 不过门
```

## 接口签名
- `isWriteTool(name): boolean`
- `previewEdit(tool, args): Promise<{path, before, after, ok, error?, code?, line?, isNew?}>` — dry-run
- `unifiedDiff(before, after, path): string` — 彩色 unified diff（LCS，折叠未变行）
- `applyEdit(tool, args): Promise<result>` — 经 executeTool 落盘

## 边界条件
- hash_edit 失配 → `{ok:false, code:'HASH_STALE', hint}`（不抛）
- edit_file search 不存在/不唯一 → `{ok:false, error}`
- write_file 目标不存在 → before='', isNew=true（新建）
- 文件不存在（非 write_file）→ `{ok:false, error:'file not found'}`
- unifiedDiff 无变更 → "(no changes)"
- hashline 必须 = md5(line).slice(0,8)，与 42.mjs/coding-lib 一致

## 文件清单
| 文件 | 职责 | 行数上限 |
|---|---|---|
| lib/edit-gate.mjs | dry-run 预览 + unified diff + 落盘 | 200 |
