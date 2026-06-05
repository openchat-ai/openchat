# spec: session-tree
> 会话树结构数据模型。消息以树形存储（非扁平列表），支持编辑分支、多 variant、批量删除。

## 数据流

```
chat-poller 检测新消息 / 用户编辑 / 用户删除
  → session-tree API 操作树结构
  → _tree.json 读写 Qiniu: oc/chat/{chatId}/_tree.json
  → Flutter 端读取 _tree.json 渲染树 UI

树结构:
  nodes[] — 每个节点 {id, role, content, parent, ts, variants?, activeVariant?}
  getCurrentPath() — 按 currentChild 遍历，输出线性路径
```

## 接口签名

```js
loadTree(chatId: string): Promise<{ version, nodes }>
saveTree(chatId, tree): Promise<void>
getCurrentPath(tree): Node[]
getParentForNewUser(tree): string|null
addNode(chatId, content, role, parentId, extra?): Promise<Node>
addVariant(chatId, nodeId, content): Promise<Node>
editMessage(chatId, nodeId, newContent): Promise<{ oldContent, newContent, pruned }>
getNodeWithVariants(tree, nodeId): Node|null
deleteSession(chatId): Promise<object[]>
handleSignal(chatId, signalFile, signalContent): Promise<object|null>
rebuildTreeFromFiles(chatId, msgKeys, replyMap): Promise<Tree>
ensureTree(chatId, msgKeys, replyMap): Promise<Tree>
```

## 边界条件

| 条件 | 预期行为 |
|------|---------|
| _tree.json 不存在 | loadTree → { version: 1, nodes: [] } |
| editMessage 编辑 root | 删除 root 所有子节点 |
| editMessage 编辑中间节点 | 删除该节点所有后代 |
| addVariant 到非 assistant 节点 | throw "not assistant" |
| 编辑使 parent.currentChild=null | 父节点 currentChild 重置 |
| deleteSession | S3 LIST + 逐个 DELETE 所有文件 |
| 树为空 | getCurrentPath → []

## 文件清单

| 文件 | 职责 | 行数上限 |
|------|------|---------|
| `src/core/session-tree.mjs` | 树结构 CRUD | 170 |

## 不变量

```
// === invariants ===
// - _tree.json is the source of truth; .msg / -reply.json files are legacy compat
// - Each node has: id, role('user'|'assistant'), content, parent(null|nodeId), ts
// - Assistant nodes have optional: variants[{content,ts}], activeVariant(index)
// - Tree is reconstructed from _tree.json on each poll (disk-backed, not in-memory)
// - Signal files: _edit_{nodeId}, _reanswer_{nodeId} — consumed then skipped in seenKeys
// - Signal files: _delete.signal — deletes all files under chatId prefix
// - New user node is always appended to latest leaf of current path
// - _tree.json has version field for cache invalidation
```
