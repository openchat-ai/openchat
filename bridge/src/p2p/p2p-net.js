import logger from '../core/monitoring/logger.js';

/**
 * P2P Network Manager — direct TCP connections + TopicRegistry
 *
 * No hyperswarm/DHT dependency. Nodes connect via:
 * 1. Direct TCP (local LAN or configured peer addresses)
 * 2. TopicRegistry for distributed topic discovery
 */
import net from 'net';
import crypto from 'crypto';
import os from 'os';
import { EventEmitter } from 'events';
import TopicRegistry from './topic-registry.js';
import { DEFAULT_PORT } from '../constants.js';

class P2PNet extends EventEmitter {
  constructor(options = {}) {
    super();
    this._peerId = options.identity?.name || `bridge-${Date.now().toString(36)}`;
    this._hostId = options.hostId || this._peerId;
    this.connectedPeers = new Map();
    this.directPeers = new Map();
    this.peerInfo = new Map();
    this._knownPeers = options.knownPeers || [];
    this._directListenPort = 0;

    // Topic registry for distributed topic discovery
    this.topicRegistry = new TopicRegistry({ ttl: options.ttl || 120_000 });
    this.topicRegistry.setP2PSend((msg) => this.broadcast(msg));

    // Wire TopicRegistry events to P2PNet events
    this.topicRegistry.on('peer_joined', (peer) => this.emit('peer_joined', peer));
    this.topicRegistry.on('peer_left', (peer) => this.emit('peer_left', peer));

    // Route incoming P2P messages to TopicRegistry
    this.on('message', ({ from, payload }) => {
      if (payload && (payload.type === 'topic_announce' || payload.type === 'topic_leave' || payload.type === 'topic_query')) {
        this.topicRegistry.handleMessage(payload);
      }
    });

    // Cleanup old connections periodically
    this.cleanupTimer = setInterval(() => this.cleanupPeers(), 30000);
    this.cleanupTimer.unref();
  }

  get peerId() { return this._peerId; }

  // ------ Direct TCP server ------

  listenDirect(port) {
    if (!port) return;
    this._directServer = net.createServer((socket) => {
      const peerId = `direct-${Date.now().toString(36)}`;
      this.connectedPeers.set(peerId, socket);
      this.peerInfo.set(peerId, { type: 'direct', connectedAt: Date.now() });
      this.emit('peer_connected', peerId);

      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        // Process complete messages (simple newline-delimited for now)
        while (buf.includes(0x0A)) {
          const idx = buf.indexOf(0x0A);
          const msg = buf.subarray(0, idx);
          buf = buf.subarray(idx + 1);
          try {
            const parsed = JSON.parse(msg.toString());
            this.emit('message', { from: peerId, payload: parsed });
          } catch { logger.warn('[P2P] incoming JSON parse failed'); }
        }
      });

      socket.on('close', () => {
        this.connectedPeers.delete(peerId);
        this.peerInfo.delete(peerId);
        this.emit('peer_disconnected', peerId);
      });
      socket.on('error', () => { logger.warn('[P2P] socket error'); });
    });

    this._directServer.listen(port, '0.0.0.0', () => {
      console.log(`[P2P] Direct TCP listening on port ${port}`);
      this._directListenPort = port;
    });
  }

  // ------ Send / broadcast ------

  sendTo(peerId, data) {
    const socket = this.connectedPeers.get(peerId);
    if (socket && !socket.destroyed) {
      socket.write(JSON.stringify(data) + '\n');
      return true;
    }
    return false;
  }

  broadcast(data) {
    const msg = JSON.stringify(data) + '\n';
    for (const [id, socket] of this.connectedPeers) {
      if (!socket.destroyed) socket.write(msg);
    }
  }

  // ------ Connect to known peers ------

  async start() {
    // Connect to configured known peers
    for (const peer of this._knownPeers) {
      this._connectTo(peer);
    }
    console.log(`[P2P] Started, peerId: ${this._peerId.slice(0, 8)}...`);
  }

  _connectTo(peer) {
    const host = peer.host || 'localhost';
    const port = peer.port || DEFAULT_PORT + 1;
    const socket = new net.Socket();

    socket.connect(port, host, () => {
      const peerId = `peer-${host}-${port}`;
      this.connectedPeers.set(peerId, socket);
      this.peerInfo.set(peerId, { host, port, connectedAt: Date.now() });
      this.emit('peer_connected', peerId);

      let buf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.includes(0x0A)) {
          const idx = buf.indexOf(0x0A);
          const msg = buf.subarray(0, idx);
          buf = buf.subarray(idx + 1);
          try {
            const parsed = JSON.parse(msg.toString());
            this.emit('message', { from: peerId, payload: parsed });
          } catch { logger.warn('[P2P] connect-side JSON parse failed'); }
        }
      });
    });

    socket.on('error', (err) => {
      console.log(`[P2P] Cannot connect to ${host}:${port} — ${err.message}`);
    });

    socket.setTimeout(5000);
    socket.on('timeout', () => {
      socket.destroy();
    });
  }

  // ------ Query methods ------

  getConnectedPeers() {
    return [...this.connectedPeers.keys(), ...this.directPeers.keys()];
  }

  queryTopicPeers(topic, excludePeerId) {
    return this.topicRegistry.getLocalPeers(topic, excludePeerId);
  }

  cleanupPeers() {
    for (const [peerId, conn] of this.connectedPeers) {
      if (conn.destroyed) this.connectedPeers.delete(peerId);
    }
  }

  // ------ Lifecycle ------

  stop() {
    if (this._directServer) this._directServer.close();
    for (const conn of this.connectedPeers.values()) conn.destroy();
    this.connectedPeers.clear();
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }
}

export { P2PNet, hasPublicAddress };
export default P2PNet;

function hasPublicAddress() { return false; }
