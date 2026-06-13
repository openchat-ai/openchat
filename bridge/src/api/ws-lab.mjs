// ws-lab.mjs — /lab WebSocket 推送 (替代 5s 轮询)
//
// 设计:
//   - path: /lab/ws  (跟 /ws chat 错开, 不冲突)
//   - 单向推: server → client, 客户端不需发消息
//   - 客户端连上立即送 {channel:'hello', at:...} 一条 (验通 + 客户端拿时间)
//   - labEvents 任何 emit → 广播给所有 client (含 file watcher 跨进程感知)
//   - 没有持久化, 断线不补发 — 客户端重连后自己调 /lab/api/* 拉最新
//
// 实现细节:
//   - 用 noServer 模式, 通过 apiServer.registerWebSocket('/lab/ws', wss) 让中央
//     upgrade dispatcher (server.js startWSDispatch) 接管 — 避免多个 WSS
//     直接绑 {server} 时第一个 WSS 的 upgrade 监听器 abort 400 别人
//
// 不做:
//   - 认证 (跟随 /lab API 同假设: 桥内 trust)
//   - 消息确认 ack (fire-and-forget)
//   - 压缩 (lab 事件量小, 没必要)

import { WebSocketServer } from 'ws';
import { labEvents } from '../lab/lab-events.mjs';

export function attachLabWS(apiServer, httpServer) {
  // 用 apiServer.registerWebSocket(path, wss) 让中央 dispatcher 接管 upgrade
  // — 避免跟 /ws, /signaling 抢 upgrade 事件
  const wss = new WebSocketServer({ noServer: true });
  apiServer.registerWebSocket('/lab/ws', wss);

  const clients = new Set();

  const broadcast = (msg) => {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === 1) {
        try { ws.send(data); } catch { /* drop on send error */ }
      }
    }
  };

  const onQueue = (evt) => broadcast({ channel: 'queue', at: Date.now(), ...evt });
  const onHistory = (evt) => broadcast({ channel: 'history', at: Date.now(), ...evt });
  const onEscalate = (evt) => broadcast({ channel: 'escalate', at: Date.now(), ...evt });
  const onRunner = (evt) => broadcast({ channel: 'runner', at: Date.now(), ...evt });
  labEvents.on('queue', onQueue);
  labEvents.on('history', onHistory);
  labEvents.on('escalate', onEscalate);
  labEvents.on('runner', onRunner);

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify({ channel: 'hello', at: Date.now(), message: 'lab ws connected' }));
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  httpServer.on('close', () => {
    labEvents.off('queue', onQueue);
    labEvents.off('history', onHistory);
    labEvents.off('escalate', onEscalate);
    labEvents.off('runner', onRunner);
    wss.close();
  });

  return { wss, clients };
}
