# E39 / E40 — Real Coding Task 端到端实验报告

**目标**：测 "narrow + template + tool call" scaffold 在 真实编码任务 上的端到端表现。
LLM 写完整 `mqttSubscribe({host, port, topic, clientId})` 函数, 内部用 `renderConnect` + `renderSubscribe` 两个工具, 通过 mock net.Socket sandbox 验证字节正确。

**模型**：MiniMax-M3 (default) × 3 次

---

## 0. 实验分两阶段

- **E39 (初版)**: prompt 简短, sandbox mock 简单, 3/3 timeout 在 compile / 事件层
- **E40 (修复)**: prompt 重写 + sandbox 3 处补全, 3/3 端到端跑通, 8 维全 100%

---

## 1. 8 维评分结果 (E40 最终)

| 维度 | E39 (初版) | **E40 (修复后)** | 含义 |
|---|---|---|---|
| `sourceExtracted` | 100% | **100%** | LLM 写了 ```js 代码块 |
| `functionShapeOk` | 100% | **100%** | 声明了 `async function mqttSubscribe` |
| `renderConnectCalled` | 100% | **100%** | 源码里出现 `renderConnect(...)` |
| `renderConnectArgsOk` | 100% | **100%** | CONNECT 参数 json 跟 expected 匹配 |
| `renderSubscribeCalled` | 100% | **100%** | 源码里出现 `renderSubscribe(...)` |
| `renderSubscribeArgsOk` | 100% | **100%** | SUBSCRIBE 参数 json 跟 expected 匹配 |
| `sandboxRan` | **0%** | **100%** | 沙盒跑通, 函数返回 |
| `packetsSentCorrect` | **0%** | **100%** | 端到端字节跟 expected 完全等 |

aggregate (E40): `{"n":3,"sourceExtracted":1,"functionShapeOk":1,"renderConnectCalled":1,"renderConnectArgsOk":1,"renderSubscribeCalled":1,"renderSubscribeArgsOk":1,"sandboxRan":1,"packetsSentCorrect":1}`

3/3 runs, 3 个 packets (CONNECT 22 bytes + SUBSCRIBE 15 bytes = 37 bytes), 字节对 expected 完全等。

---

## 2. E39 → E40 修了 3 处

### 2.1 修 1: prompt 重写 (task.json)

**E39 prompt** (问题: 太简洁, LLM 用 CommonJS 风格):
> Write a Node.js async function `mqttSubscribe({host, port, topic, clientId})` using renderConnect and renderSubscribe tools...

**E40 prompt** (显式约束: await, 禁 require/import/module.exports):
> Use `await` for BOTH `renderConnect(...)` and `renderSubscribe(...)` (they are async).
> Use the global `net` object — do NOT write `require('net')`, `import` statements, or `module.exports`.
> Output ONLY the complete function source in a ```js code block``` (no imports, no exports, no extra top-level code).

效果: 3/3 LLM 不再写 `const net = require('net')` / `module.exports = ...`, 改用纯函数体 + await。

### 2.2 修 2: preprocessSource 加 `module.exports` 过滤 (sandbox.mjs)

```js
if (/^module\.exports\s*=/.test(t)) return false;  // CommonJS — 残留会让 Function 构造器编译挂
```

这修了 run 1 残留的 `module.exports = mqttSubscribe;` 编译挂 (LLM 写完函数后习惯加这一行)。

### 2.3 修 3: sandbox mock 3 处补全 (sandbox.mjs)

LLM 写法演进揭示 3 个 mock gap, 全部补上:

**A. `net.connect` 当工厂函数 (不 new)**
```js
// E39: net.connect = MockSocket (构造函数) — LLM 调 net.connect({host, port}, cb) 时 args 被忽略
// E40: 包装成真工厂
function factoryConnect(...args) {
  const sock = new MockSocket();
  sock.connect(...args);
  return sock;
}
return { Socket: MockSocket, connect: factoryConnect, createConnection: factoryConnect };
```
根因: 真实 Node `net.connect()` 是工厂 — 创建 socket 并自动 connect. E39 mock 当构造函数, 调它等于 `new MockSocket()`, 没传 args, 没自动 connect, 永远 fire 不了 callback。

**B. `socket.write(buf, callback)` 支持 callback**
```js
sock.write = function (data, encodingOrCallback, maybeCallback) {
  const callback = typeof encodingOrCallback === 'function' ? encodingOrCallback : maybeCallback;
  ...
  if (callback) setImmediate(() => { try { callback(); } catch (e) { /* 'error' 事件 */ } });
  ...
};
```
根因: 真实 Node `write(data, [encoding], callback)` 在数据 flush 后调 callback. E39 mock 只接 (data, encoding), callback 丢失, LLM 写 `socket.write(buf, () => resolve())` 永远不 resolve。

**C. setImmediate 里的 callback 用 try-catch 包**
```js
setImmediate(() => {
  try { ... } catch (e) {
    const errListeners = sock._listeners?.error || [];
    for (const l of errListeners) l.call(sock, e);
  }
});
```
根因: 之前 setImmediate 抛错会变成 uncaughtException 让 Node 进程崩, 整个 runLive 链断, 拿不到剩余 run 的数据。现在 'error' 事件兜底, LLM 写法有问题也能 graceful 拿到 sandbox 错误。

---

## 3. 实际 LLM 写的源码 (E40 3/3 同模式)

```js
async function mqttSubscribe({host, port, topic, clientId}) {
  const connectPacket = await renderConnect({
    protoName: 'MQTT', protoLevel: 4,
    connectFlags: { cleanSession: true },
    keepAlive: 60, clientId
  });
  const subscribePacket = await renderSubscribe({
    packetId: 1, subscriptions: [{ topic, qos: 1 }]
  });
  return new Promise((resolve, reject) => {
    const socket = net.connect({host, port}, () => {
      socket.write(Buffer.from(connectPacket.bytes), (err) => {
        if (err) return reject(err);
        socket.write(Buffer.from(subscribePacket.bytes), (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
    socket.on('error', reject);
  });
}
```

3/3 LLM 都写出**结构等价**的代码 (只有 write 嵌套风格略有差异)。代码本身没 bug, sandbox 端到端跑通, 字节完全对 expected。

---

## 4. 评分维度解读

### 4.1 tool call 6 维全 100% (E39/E40 一致)

E39 第一轮就 6/6 全过, E40 修复后保持:
- LLM 知道**调什么工具** (renderConnect + renderSubscribe)
- LLM 知道**参数是什么** (protoName/protoLevel/.../subscriptions)
- 参数 json 跟 expected **完全匹配** (clientId/topic 是变量引用, 用 `{_var: 'name'}` 标记, jsonMatches 容忍)

**E38 证明 tool schema + tool call 路径在 JSON 层面已经稳定 (87% exactMatch)。E40 证明同样的能力能迁移到 "写完整代码 + 工具调用 + sandbox 端到端跑通"**。

### 4.2 sandbox + 字节 2 维 E39→E40: 0% → 100%

E40 修复关键点:
- ✅ 修 prompt 让 LLM 写 ESM 风格 (await, 无 require, 无 module.exports)
- ✅ preprocessSource 兜底剥 CommonJS 残留
- ✅ sandbox mock 跟真实 Node API 对齐 (工厂 connect + write callback)
- ✅ try-catch 兜底不让 LLM 写错时崩进程

**这是 C 计划的"JS 整合脚手架"补全**: model + scaffold 的 4 件套 (tool + 窄 + schema + fallback) 在 tool call 层早就稳定, 之前卡的是 sandbox mock 跟真实 Node 行为不一致 + LLM 默认 CommonJS 风格两个工程问题, 不是模型能力问题。

---

## 5. 跟 E36/E37/E38 横向对比

| 实验 | 任务形态 | 端到端通过率 | 失败模式 |
|---|---|---|---|
| **E36** (raw) | LLM 写完整 MQTT 字节 (无工具) | 27% (4/15) | 字节算错 + 6/15 超时 |
| **E37** (template) | LLM 填 JSON, scaffold 渲染字节 | 67% (10/15) | JSON 抽错 + 字段错 |
| **E38** (combined) | LLM 调 4 个 render* 工具 | 87% (13/15) | 工具调用错 |
| **E39** (real task 初版) | LLM 写完整函数 + 2 工具 + sandbox | 0% (0/3) | CommonJS + sandbox mock gap |
| **E40** (real task 修复) | 同上 + JS 整合脚手架 | **100% (3/3)** | — |

E36 → E37 → E38 → E40 单调递增, 每一步都在**不换模型**的前提下, 用 scaffold 拉高通过率。

---

## 6. 结论

- **C 计划 4 件套 (tool + 窄 + schema + fallback) 在弱模型上能做端到端编码任务**:
  - E38 87% (JSON 工具调用)
  - E40 **100%** (写完整函数 + sandbox 端到端跑通 + 字节对)
- **JS 整合脚手架是第 5 件套**: E40 揭示, 光有 tool/scaffold 还不够, 还需要:
  1. Prompt 显式约束 LLM 写 ESM 风格 (await + 禁 CommonJS)
  2. Sandbox mock 跟真实 Node API 对齐 (工厂 connect, write callback)
  3. preprocessSource 兜底剥 LLM 写错的 CommonJS 残留
  4. Try-catch 兜底不让 LLM 错误崩进程
- **C 计划上限还没到**: 5 件套都补齐后 100% 端到端, 接下来可以扩任务复杂度 (E41: 多步 MQTT client with onMessage) 验证 scaffold 横向扩展性。

**E40 完成度**: 端到端 sandbox 验证 ✅ (3/3, 字节对 expected), C 计划 JS 整合脚手架第 5 件套已落地。
