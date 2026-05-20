# P2P 语音通话端到端教程

## 前置条件

- Node.js 24+
- 两个终端窗口

## 第一步：启动 Bridge（主节点）

```bash
cd bridge
npm install
npm start -- --sandbox
```

终端输出显示 `[P2P] Hyperswarm 网络已加入` 表示 P2P 网络已启动。

## 第二步：启动第二个 Bridge（连接节点）

新终端窗口：

```bash
cd bridge
node src/main.js --sandbox --nesting --port=3002
```

第二个节点会自动发现主节点并进行直连 TCP 握手。

## 第三步：验证 P2P 连接

在主节点终端输入：

```
/status
```

输出中应显示已连接的 peer 数量 > 0。

## 第四步：语音通话（Flutter 客户端）

```bash
cd openchat-flutter
flutter run
```

Flutter 客户端会自动连接 bridge 的 WebSocket 信令端点。

1. 点击「设置」→ 输入 bridge 地址：`ws://localhost:3800/signaling`
2. 点击「连接」
3. 点击「发起通话」向在线 peer 发起 WebRTC 呼叫

## 第五步：验证音频流

- 通话建立后，两个 peer 会显示「已连接」
- 音频通过 P2P 直连传输（不经服务器中转）

## 常见问题

| 问题 | 解决 |
|------|------|
| Flutter 连不上 bridge | 确认 bridge 在 3800 端口运行 |
| P2P 发现不了 peer | 检查两个节点是否相同端口组 |
| 音频无声音 | 确认 RNNoise WASM 已正确加载 |
