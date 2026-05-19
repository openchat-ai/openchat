/**
 * P2P Swarm Manager
 * 使用 hyperswarm 实现基础 P2P 能力
 *
 * 修订说明：根据混合方案，使用 hyperswarm 替代自定义 DHT
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let Hyperswarm;
try { Hyperswarm = require('hyperswarm'); } catch { Hyperswarm = null; }
const crypto = require('crypto');
const net = require('net');
const os = require('os');
const EventEmitter = require('events');

import { MessageType } from './messages.js';
import NodeIdentity from './identity.js';
import { detectNatType, getDefaultIceServers } from './nat-traversal.js';

// --- 粘包处理：消息帧工具 ---

/**
 * 4字节大端长度头 + JSON 字节
 */
function createFrame(obj) {
  const json = JSON.stringify(obj);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * 环形缓冲：积累 TCP 数据并提取完整消息帧（按长度头切割）
 */
class MessageBuffer {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * 喂入原始 TCP 数据，返回完整消息体 Buffer 数组
   */
  feed(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    const messages = [];
    while (this.buffer.length >= 4) {
      const len = this.buffer.readUInt32BE(0);
      if (this.buffer.length < 4 + len) break;
      messages.push(this.buffer.slice(4, 4 + len));
      this.buffer = this.buffer.slice(4 + len);
    }
    return messages;
  }
}

/**
 * 检测本机是否有公网 IPv4 地址（遍历网卡，跳过 10/172.16-31/192.168/127）
 */
function hasPublicAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const parts = iface.address.split('.').map(Number);
      if (parts[0] === 10) continue;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) continue;
      if (parts[0] === 192 && parts[1] === 168) continue;
      if (parts[0] === 127) continue;
      return true;
    }
  }
  return false;
}

/**
 * 获取第一个公网 IPv4 地址，没有则返回 null
 */
function getPublicIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      const parts = iface.address.split('.').map(Number);
      if (parts[0] === 10) continue;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) continue;
      if (parts[0] === 192 && parts[1] === 168) continue;
      if (parts[0] === 127) continue;
      return iface.address;
    }
  }
  return null;
}

class P2PSwarm extends EventEmitter {
  constructor(options = {}) {
    super();
    this.swarm = null;
    this.topic = options.topic || Buffer.alloc(32).fill('openchat'); // 默认主题
    this.nodeIdentity = options.nodeIdentity || new NodeIdentity();
    this.peerId = this.nodeIdentity.peerId;
    this.connectedPeers = new Map();    // Hyperswarm DHT connections
    this.directPeers = new Map();       // Direct TCP connections (bypass DHT)
    this.messageQueue = [];
    this.isRunning = false;
    this.dhtPort = options.dhtPort || 0;          // 0 = 随机端口
    this.localBootstrap = options.localBootstrap || []; // [{ host, port }]
    this.knownPeers = options.knownPeers || [];       // [{ host, port }] — direct TCP fallback
    this.identity = options.identity || { name: this.peerId.slice(0, 8), region: 'unknown' };
    this.peerInfo = new Map();          // peerId → { name, region, residentCount, uptime }
    this.hostIsPublic = options.hostIsPublic || false;
    this.wsSignalingUrl = options.wsSignalingUrl || '';
    this.registry = options.registry || null;
    this.stunServers = options.stunServers || getDefaultIceServers();
    this.natType = 'unknown';

    console.log(`[P2P] 已初始化，节点ID: ${this.peerId.slice(0, 8)}...`);
  }

  /**
   * 启动 P2P 网络
   */
  async start() {
    if (this.isRunning) {
      console.log('[P2P] 已在运行');
      return;
    }

    try {
      // Detect NAT type on startup
      detectNatType().then(type => {
        this.natType = type;
        console.log(`[P2P] NAT type: ${type}`);
      }).catch(() => {});

      if (Hyperswarm) {
        const hyperswarmOpts = {
        maxPeers: 50,
        cache: false,
        fastJoin: true,
        port: this.dhtPort > 0 ? this.dhtPort : undefined
      };

      // 先试 config 缓存的 localBootstrap
      if (this.localBootstrap.length > 0) {
        hyperswarmOpts.bootstrap = this.localBootstrap;
      }

      this.swarm = new Hyperswarm(hyperswarmOpts);

      // 只有公网节点才标记 firewalled=false，让 hyperswarm 中继生效
      const isPublic = this.hostIsPublic || hasPublicAddress();
      if (isPublic && this.swarm.dht) {
        this.swarm.dht.firewalled = false;
      }
      if (isPublic) {
        this.swarm.dht?.on?.('ready', () => {
          this.swarm.dht.firewalled = false;
        });
      }
      console.log(`[P2P] 公网节点: ${isPublic}${isPublic ? ' (firewalled=false, 可作为中继)' : ' (firewalled=auto, 经中继通信)'}`);

      this.swarm.on('connection', (conn, info) => {
        this.handleConnection(conn, info);
      });

      this.swarm.on('peer', (peer) => {
        console.log(`[P2P] DHT 发现节点: ${peer.publicKey?.toString('hex')?.slice(0, 8) || 'unknown'}...`);
      });

      // 加入主题（带超时）
      const discovery = this.swarm.join(this.topic);
      const joinOk = await Promise.race([
        discovery.flushed().then(() => true),
        new Promise(resolve => setTimeout(resolve, 5000)).then(() => false)
      ]);

      if (!joinOk && this.registry) {
        // DHT 引导失败 → 通过 registry 发现其他节点
        console.log('[P2P] DHT 加入超时，正在尝试注册中心...');
        try {
          const onlinePeers = await this.registry.discoverPeers();
          for (const p of onlinePeers) {
            const dhtPort = p.dhtPort || 4977;
            if (!this.localBootstrap.find(b => b.host === p.host && b.port === dhtPort)) {
              this.localBootstrap.push({ host: p.host, port: dhtPort });
            }
            const tcpPort = p.port || 3000;
            if (!this.knownPeers.find(k => k.host === p.host && k.port === tcpPort)) {
              this.knownPeers.push({ host: p.host, port: tcpPort });
            }
          }
          if (onlinePeers.length > 0) {
            console.log(`[P2P] 注册中心发现 ${onlinePeers.length} 个节点 (${onlinePeers.some(p => p.stale) ? '含过期' : '全部在线'})`);
          }
        } catch (e) {
          console.log(`[P2P] 注册中心发现失败: ${e.message}`);
        }
      }
      } else {
        console.log('[P2P] hyperswarm 不可用，仅使用直连模式');
      }

      this.isRunning = true;
      console.log(`[P2P] 已加入主题: ${this.topic.toString('hex').slice(0, 8)}...`);

      // 直连所有 known peers
      for (const peer of this.knownPeers) {
        this.connectPeer(peer.host, peer.port);
      }

      this.cleanupTimer = setInterval(() => this.cleanupPeers(), 30000);

    } catch (error) {
      console.error('[P2P] 启动失败:', error.message);
      throw error;
    }
  }

  /**
   * 停止 P2P 网络
   */
  async stop() {
    if (!this.swarm) return;

    try {
      // 停止清理定时器
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      this.swarm.leave(this.topic);
      this.swarm.destroy();
      // 关闭直连服务器
      if (this.directServer) {
        this.directServer.close();
        this.directServer = null;
      }
      // 关闭所有直连 socket
      for (const [, socket] of this.directPeers) {
        socket.destroy();
      }
      this.connectedPeers.clear();
      this.directPeers.clear();
      this.isRunning = false;
      console.log('[P2P] 已停止');
    } catch (error) {
      console.error('[P2P] 停止错误:', error.message);
    }
  }

  /**
   * 处理新连接
   */
  handleConnection(conn, info) {
    let peerId;
    try {
      peerId = conn?.peer?.publicKey?.toString('hex') || crypto.randomBytes(8).toString('hex');
    } catch {
      peerId = crypto.randomBytes(8).toString('hex');
    }

    console.log(`[P2P] 新连接来自: ${peerId.slice(0, 8)}... (${info.client ? '客户端' : '服务端'})`);

    // 设置连接超时
    conn.setTimeout(30000);

    // 处理数据（带粘包处理）
    const recvBuf = new MessageBuffer();
    conn.on('data', (data) => {
      for (const msg of recvBuf.feed(data)) {
        this.handleMessage(peerId, msg);
      }
    });

    // 处理断开
    conn.on('close', () => {
      console.log(`[P2P] 连接已关闭: ${peerId.slice(0, 8)}...`);
      this.connectedPeers.delete(peerId);
      this.peerInfo.delete(peerId);
      this.emit('peer-disconnected', peerId);
    });

    // 处理错误
    conn.on('error', (error) => {
      console.error(`[P2P] 连接错误: ${error.message}`);
      this.connectedPeers.delete(peerId);
      this.peerInfo.delete(peerId);
    });

    // 保存连接
    this.connectedPeers.set(peerId, conn);

    this.emit('peer-connected', peerId);

    // 发送握手消息
    this.sendHandshake(peerId, conn);

    // 身份交换：把自己的身份信息发给对方
    this.sendIdentity(peerId, conn);
  }

  /**
   * 直接 TCP 连接到指定 peer（绕过 DHT 发现）
   * 用于同一局域网 / 已知地址的场景
   */
  connectPeer(host, port, label) {
    const peerKey = label || `${host}:${port}`;
    console.log(`[P2P] 直连中: ${host}:${port}...`);

    const socket = net.createConnection({ host, port }, () => {
      console.log(`[P2P] 直连已建立: ${host}:${port}`);
    });

    socket.setTimeout(10000);

    // 处理数据（带粘包处理）
    const recvBuf = new MessageBuffer();
    socket.on('data', (data) => {
      for (const msg of recvBuf.feed(data)) {
        this.handleDirectMessage(peerKey, socket, msg);
      }
    });

    socket.on('close', () => {
      console.log(`[P2P] 直连已关闭: ${host}:${port}`);
      this.directPeers.delete(peerKey);
      this.peerInfo.delete(peerKey);
      this.emit('peer-disconnected', peerKey);
    });

    socket.on('error', (error) => {
      console.error(`[P2P] 直连错误 (${host}:${port}): ${error.message}`);
      this.directPeers.delete(peerKey);
      this.peerInfo.delete(peerKey);
    });

    this.directPeers.set(peerKey, socket);
    this.emit('peer-connected', peerKey);

    // 发送握手（带帧头）
    const handshake = this.nodeIdentity.createHandshake();
    socket.write(createFrame({
      type: 'HANDSHAKE',
      ...handshake,
      version: '1.0'
    }));

    // 发送身份信息
    this.sendIdentity(this.peerId, socket);
  }

  /**
   * 创建直接 TCP 服务器（供其他 peer 直连）
   */
  listenDirect(port, host = '0.0.0.0') {
    if (this.directServer) return;
    this.directServer = net.createServer((socket) => {
      const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
      console.log(`[P2P] 直连入站: ${remoteAddr}`);
      socket.setTimeout(10000);

      // 发送握手回复（带帧头）
      const handshake = this.nodeIdentity.createHandshake();
      socket.write(createFrame({
        type: 'HANDSHAKE',
        ...handshake,
        version: '1.0'
      }));

      // 发送身份信息
      this.sendIdentity(this.peerId, socket);

      // 处理数据（带粘包处理）
      const recvBuf = new MessageBuffer();
      socket.on('data', (data) => {
        for (const msg of recvBuf.feed(data)) {
          this.handleDirectMessage(remoteAddr, socket, msg);
        }
      });

      socket.on('close', () => {
        const id = socket._peerId?.slice(0, 8) || remoteAddr;
        console.log(`[P2P] 直连入站已关闭: ${id}...`);
        this.directPeers.delete(socket._peerId || remoteAddr);
      });

      socket.on('error', (err) => {
        const id = socket._peerId?.slice(0, 8) || remoteAddr;
        console.error(`[P2P] 直连入站错误 (${id}): ${err.message}`);
        this.directPeers.delete(socket._peerId || remoteAddr);
      });
    });

    this.directServer.listen(port, host, () => {
      console.log(`[P2P] 直连 TCP 服务器正在监听 ${host}:${port}`);
    });
  }

  /**
   * 处理直接 TCP 消息（统一消息处理）
   */
  handleDirectMessage(peerKey, socket, data) {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'HANDSHAKE') {
        const result = NodeIdentity.verifyHandshake(message);
        if (!result.valid) {
          console.error(`[P2P] 握手验证失败: ${result.reason}`);
          socket.end();
          return;
        }
        console.log(`[P2P] 直连握手来自: ${result.peerId.slice(0, 8)}...`);
        // 用对方 peerId 替换 key 以便识别
        if (!this.directPeers.has(result.peerId)) {
          this.directPeers.set(result.peerId, socket);
          this.directPeers.delete(peerKey);
          socket._peerId = result.peerId;
        }
        return;
      }

      // 使用已解析的 peerId（优先），回退到原始 peerKey
      const resolvedPeerId = socket._peerId || peerKey;
      // 统一走 handleMessage 逻辑
      this.handleMessage(resolvedPeerId, data);
    } catch (error) {
      console.error(`[P2P] 直连消息错误: ${error.message}`);
    }
  }

  /**
   * 发送握手消息
   */
  sendHandshake(peerId, conn) {
    try {
      const handshake = this.nodeIdentity.createHandshake();
      conn.write(createFrame({
        type: 'HANDSHAKE',
        ...handshake,
        version: '1.0'
      }));
    } catch (error) {
      console.error(`[P2P] 握手失败: ${error.message}`);
    }
  }

  /**
   * 发送身份信息给已连接的 peer
   */
  sendIdentity(peerId, conn) {
    const isPublic = this.hostIsPublic || hasPublicAddress();
    const info = {
      type: 'IDENTITY',
      info: {
        name: this.identity.name,
        region: this.identity.region,
        residentCount: this.identity.residentCount || 0,
        uptime: process.uptime(),
        publicRelay: isPublic,
        wsSignaling: this.wsSignalingUrl || ''
      },
      timestamp: Date.now()
    };
    try {
      conn.write(createFrame(info));
    } catch (error) {
      console.error(`[P2P] 身份发送失败: ${error.message}`);
    }
  }

  /**
   * 处理接收到的消息
   */
  handleMessage(peerId, data) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'HANDSHAKE': {
          const result = NodeIdentity.verifyHandshake(message);
          if (!result.valid) {
            console.error(`[P2P] 握手验证失败 (${peerId.slice(0, 8)}...): ${result.reason}`);
            // Replace peerId so connection gets cleaned up by next cleanup cycle
            this.connectedPeers.delete(peerId);
            return;
          }
          // Update peerId to the verified one
          if (result.peerId !== peerId) {
            this.connectedPeers.delete(peerId);
            this.connectedPeers.set(result.peerId, this.connectedPeers.get(peerId));
          }
          console.log(`[P2P] 握手验证通过: ${result.peerId.slice(0, 8)}...`);
          break;
        }

        case 'MESSAGE':
          this.emit('message', {
            from: peerId,
            payload: message.payload,
            priority: message.priority || 'NORMAL'
          });
          break;

        case 'IDENTITY': {
          const info = message.info || {};
          this.peerInfo.set(peerId, info);
          console.log(`[P2P] 身份: ${info.name || '?'}(${info.region || '?'}) ${info.residentCount || 0}居民`);
          break;
        }

        case 'PING':
          this.sendTo(peerId, { type: 'PONG', timestamp: Date.now() });
          break;

        case 'PONG':
          // 连接活跃
          break;

        // 神经网格: 分布式权重共享
        case 'neural_share':

        case MessageType.SKILL_PUBLISH:
        case MessageType.COLLABORATION_REQUEST:
        case MessageType.COLLABORATION_RESPONSE:
        case MessageType.INSIGHT_SHARE:
        case MessageType.PERFORMANCE_REPORT:
        case MessageType.SKILL_REQUEST:
        // P2R
        case MessageType.BRIDGE_SPAWN:
        case MessageType.SAFE_HOUSE_VERIFY:
        case MessageType.BRIDGE_UPGRADE:
        case MessageType.RESIDENT_TRANSFER:
        case MessageType.HOUSE_SEEK:
        case MessageType.HOUSE_NEED:
        // P2R-S: 安全自治
        case MessageType.PROPOSE_CHANGE:
        case MessageType.VERIFY_RESULT:
        case MessageType.CHANGE_APPLIED:
        // LLM 代理
        case MessageType.LLM_PROXY_REQUEST:
        case MessageType.LLM_PROXY_RESPONSE:
        // LLM 代理：对等发现
        case MessageType.LLM_AVAILABLE:
        case MessageType.LLM_PROVIDER_QUERY:
          this.emit(message.type, { from: peerId, payload: message.payload });
          break;

        default:
          console.log(`[P2P] 未知消息类型: ${message.type}`);
      }
    } catch (error) {
      console.error(`[P2P] 消息解析错误: ${error.message}`);
    }
  }

  /**
   * 发送消息到指定 peer
   */
  sendTo(peerId, message) {
    let conn = this.connectedPeers.get(peerId);
    // 也检查直连 peer
    if (!conn) {
      conn = this.directPeers.get(peerId);
    }
    if (!conn) {
      console.log(`[P2P] 节点未连接: ${peerId.slice(0, 8)}...`);
      return false;
    }

    try {
      conn.write(createFrame(message));
      return true;
    } catch (error) {
      console.error(`[P2P] 发送失败: ${error.message}`);
      return false;
    }
  }

  /**
   * 广播消息到所有 connected peers
   */
  broadcast(message, messageType = 'MESSAGE', priority = 'NORMAL') {
    let successCount = 0;

    for (const [peerId, conn] of this.connectedPeers) {
      const msg = {
        type: messageType,
        payload: message,
        priority,
        from: this.peerId,
        timestamp: Date.now()
      };

      if (this.sendTo(peerId, msg)) {
        successCount++;
      }
    }

    for (const [peerId, conn] of this.directPeers) {
      if (this.connectedPeers.has(peerId)) continue; // 去重
      const msg = {
        type: messageType,
        payload: message,
        priority,
        from: this.peerId,
        timestamp: Date.now()
      };

      if (this.sendTo(peerId, msg)) {
        successCount++;
      }
    }

    return successCount;
  }

  /**
   * 清理断开的连接
   */
  cleanupPeers() {
    let cleaned = 0;

    for (const [peerId, conn] of this.connectedPeers) {
      if (conn.destroyed) {
        this.connectedPeers.delete(peerId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[P2P] 已清理 ${cleaned} 个失效连接`);
    }
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    const peers = [];
    for (const [peerId, info] of this.peerInfo) {
      peers.push({ peerId: peerId.slice(0, 8), ...info });
    }
    return {
      isRunning: this.isRunning,
      peerId: this.peerId.slice(0, 8),
      identity: this.identity,
      connectedCount: this.connectedPeers.size,
      directCount: this.directPeers.size,
      peers,
      topic: this.topic.toString('hex').slice(0, 8) + '...'
    };
  }

  getConnectedPeers() {
    return Array.from(this.connectedPeers.keys());
  }
}

export default P2PSwarm;
export { hasPublicAddress, getPublicIPv4 };