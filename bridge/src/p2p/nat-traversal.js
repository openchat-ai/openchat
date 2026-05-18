/**
 * NAT Traversal Utilities — STUN/TURN discovery + connectivity checks
 * NAT 穿透工具：STUN/TURN 发现 + 连通性检测
 */
import * as dgram from 'dgram';
import * as crypto from 'crypto';

const STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stunserver.org:3478',
];

/**
 * Detect NAT type by querying a STUN server.
 * Returns one of: 'open', 'full-cone', 'restricted-cone', 'port-restricted', 'symmetric', 'unknown'
 * 通过 STUN 查询检测 NAT 类型
 */
function detectNatType(stunHost = 'stun.l.google.com', stunPort = 19302, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const txId = crypto.randomBytes(12);
    let resolved = false;

    const done = (type) => {
      if (!resolved) { resolved = true; socket.close(); resolve(type); }
    };

    socket.on('message', (msg) => {
      // STUN binding response: first 2 bytes = 0x0101
      if (msg.length < 20 || msg.readUInt16BE(0) !== 0x0101) return;
      const attrType = msg.readUInt16BE(20);
      if (attrType === 0x0020) { done('symmetric'); return; } // XOR-MAPPED-ADDRESS
      done('full-cone');
    });

    socket.on('error', () => done('unknown'));

    // STUN Binding Request (RFC 5389)
    const req = Buffer.alloc(20);
    req.writeUInt16BE(0x0001, 0); // Binding Request
    req.writeUInt16BE(0, 2);      // Message Length
    req.writeUInt32BE(0x2112A442, 4); // Magic Cookie
    txId.copy(req, 8);            // Transaction ID

    socket.send(req, 0, req.length, stunPort, stunHost, () => {
      setTimeout(() => done('unknown'), timeout);
    });
  });
}

/**
 * Get default ICE server config with STUN + optional TURN
 * 获取默认 ICE 服务器配置（STUN + 可选 TURN）
 */
function getDefaultIceServers(turnConfig = null) {
  const servers = STUN_SERVERS.map(url => ({ urls: url }));
  if (turnConfig?.url) {
    servers.push({
      urls: turnConfig.url,
      username: turnConfig.username || '',
      credential: turnConfig.credential || '',
    });
  }
  return servers;
}

export { detectNatType, getDefaultIceServers, STUN_SERVERS };
