# spec: scout-shared
> scout 系统共享常量与工具函数

## 数据流
各 scanner import 共享常量 → 使用工具函数（scanDir/mapLimit/fetchJson）→ 归口去重写入

## 接口签名
- `readProjects(): object[]`
- `relPath(abs): string`
- `scanDir(dir, results, maxDepth, depth): string[]`
- `mapLimit(items, limit, fn): Promise<any[]>`
- `fetchJson(url): Promise<object|null>`
- `loadDedup(): object`
- `isProcessed(key): boolean`
- `markProcessed(key, info): void`
- `safeAtomicWrite(targetPath, newContent): Promise<boolean>`

## 边界条件
- 所有工具函数有空安全（catch {}）
- `safeAtomicWrite` 写 .new.mjs → fork --check → renameSync 原子替换
- 多并发 safeAtomicWrite 到同一文件，最后一次 rename 胜出

## 文件清单
| 文件 | 职责 |
|------|------|
| scout-shared.mjs | 常量 + 工具函数 |
