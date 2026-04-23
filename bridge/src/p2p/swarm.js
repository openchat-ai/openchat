/**
 * P2P Swarm Manager
 * 使用 hyperswarm 实现基础 P2P 能力
 *
 * 修订说明：根据混合方案，使用 hyperswarm 替代自定义 DHT
 */

const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');
const EventEmitter = require('events');

class P2PSwarm extends EventEmitter {
  constructor(options = {}) {
    super();
    this.swarm = null;
    this.topic = options.topic || Buffer.alloc(32).fill('openchat'); // 默认主题
    this.peerId = options.peerId || crypto.randomBytes(32).toString('hex');
    this.connectedPeers = new Map();
    this.messageQueue = [];
    this.isRunning = false;

    console.log(`[P2P] Initialized with peerId: ${this.peerId.slice(0, 8)}...`);
  }

  /**
   * 启动 P2P 网络
   */
  async start() {
    if (this.isRunning) {
      console.log('[P2P] Already running');
      return;
    }

    try {
      this.swarm = new Hyperswarm({
        // 简单配置
        maxPeers: 50,
        // 缓存已知的 peer
        cache: true,
        // 快速连接
        fastJoin: true
      });

      // 处理新连接
      this.swarm.on('connection', (conn, info) => {
        this.handleConnection(conn, info);
      });

      // 加入主题
      const discovery = this.swarm.join(this.topic);
      await discovery.flushed();

      this.isRunning = true;
      console.log(`[P2P] Joined topic: ${this.topic.toString('hex').slice(0, 8)}...`);

      // 定期清理断开的连接
      setInterval(() => this.cleanupPeers(), 30000);

    } catch (error) {
      console.error('[P2P] Failed to start:', error.message);
      throw error;
    }
  }

  /**
   * 停止 P2P 网络
   */
  async stop() {
    if (!this.swarm) return;

    try {
      this.swarm.leave(this.topic);
      this.swarm.destroy();
      this.connectedPeers.clear();
      this.isRunning = false;
      console.log('[P2P] Stopped');
    } catch (error) {
      console.error('[P2P] Error stopping:', error.message);
    }
  }

  /**
   * 处理新连接
   */
  handleConnection(conn, info) {
    const peerId = conn.peer.publicKey?.toString('hex') || crypto.randomBytes(8).toString('hex');

    console.log(`[P2P] New connection from: ${peerId.slice(0, 8)}... (${info.client ? 'client' : 'server'})`);

    // 设置连接超时
    conn.setTimeout(30000);

    // 处理数据
    conn.on('data', (data) => {
      this.handleMessage(peerId, data);
    });

    // 处理断开
    conn.on('close', () => {
      console.log(`[P2P] Connection closed: ${peerId.slice(0, 8)}...`);
      this.connectedPeers.delete(peerId);
      this.emit('peer-disconnected', peerId);
    });

    // 处理错误
    conn.on('error', (error) => {
      console.error(`[P2P] Connection error: ${error.message}`);
      this.connectedPeers.delete(peerId);
    });

    // 保存连接
    this.connectedPeers.set(peerId, conn);

    this.emit('peer-connected', peerId);

    // 发送握手消息
    this.sendHandshake(peerId, conn);
  }

  /**
   * 发送握手消息
   */
  sendHandshake(peerId, conn) {
    const handshake = {
      type: 'HANDSHAKE',
      peerId: this.peerId,
      version: '1.0',
      timestamp: Date.now()
    };

    try {
      conn.write(JSON.stringify(handshake));
    } catch (error) {
      console.error(`[P2P] Handshake failed: ${error.message}`);
    }
  }

  /**
   * 处理接收到的消息
   */
  handleMessage(peerId, data) {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case 'HANDSHAKE':
          console.log(`[P2P] Received handshake from: ${message.peerId.slice(0, 8)}...`);
          break;

        case 'MESSAGE':
          this.emit('message', {
            from: peerId,
            payload: message.payload,
            priority: message.priority || 'NORMAL'
          });
          break;

        case 'PING':
          this.sendTo(peerId, { type: 'PONG', timestamp: Date.now() });
          break;

        case 'PONG':
          // 连接活跃
          break;

        default:
          console.log(`[P2P] Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`[P2P] Message parse error: ${error.message}`);
    }
  }

  /**
   * 发送消息到指定 peer
   */
  sendTo(peerId, message) {
    const conn = this.connectedPeers.get(peerId);
    if (!conn) {
      console.log(`[P2P] Peer not connected: ${peerId.slice(0, 8)}...`);
      return false;
    }

    try {
      conn.write(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error(`[P2P] Send failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 广播消息到所有 connected peers
   */
  broadcast(message, priority = 'NORMAL') {
    let successCount = 0;

    for (const [peerId, conn] of this.connectedPeers) {
      const msg = {
        type: 'MESSAGE',
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
      console.log(`[P2P] Cleaned ${cleaned} dead connections`);
    }
  }

  /**
   * 获取连接状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      peerId: this.peerId,
      connectedPeers: this.connectedPeers.size,
      topic: this.topic.toString('hex').slice(0, 8) + '...'
    };
  }
}

module.exports = P2PSwarm;