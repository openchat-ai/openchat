/**
 * NeuralMesh — 分布式神经网格
 *
 * 每台 Fairy 训练自己的 SemanticNN。
 * 训练后广播权重到 P2P 网络。
 * 其他 Fairy 收到后加权合并到本地模型。
 * 全网的神经网络一起成长。
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve, sep } from 'path';
import { homedir } from 'os';

const MESH_DIR = join(homedir(), '.openchat', 'neural-mesh');
const LOCAL_WEIGHTS = join(MESH_DIR, 'local-weights.json');
const PEER_WEIGHTS_DIR = join(MESH_DIR, 'peers');

const MAX_HIDDEN_SIZE = 1024;
const MAX_WEIGHT_FILE_KB = 5120;

function sanitizePeerId(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return 'unknown';
  const s = String(raw);
  const safe = s.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 128);
  return safe || 'unknown';
}

function validateWeights(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.samples < 0 || data.samples > 1e9) return false;
  if (data.hiddenSize <= 0 || data.hiddenSize > MAX_HIDDEN_SIZE) return false;
  const matrices = ['W_i','U_i','W_f','U_f','W_c','U_c','W_o','U_o','W_out'];
  for (const key of matrices) {
    const m = data[key];
    if (!m || !Array.isArray(m) || m.length === 0) return false;
    for (const row of m) {
      if (!Array.isArray(row) || row.length === 0) return false;
      for (const v of row) {
        if (!Number.isFinite(v) || Math.abs(v) > 1e6) return false;
      }
    }
  }
  const vectors = ['b_i','b_f','b_c','b_o','b_out'];
  for (const key of vectors) {
    const v = data[key];
    if (!v || !Array.isArray(v)) return false;
    for (const val of v) {
      if (!Number.isFinite(val) || Math.abs(val) > 1e6) return false;
    }
  }
  return true;
}

export class NeuralMesh {
  constructor(p2p, myPort) {
    this.p2p = p2p;
    this.myPort = myPort;
    this._ensureDirs();
    this.peerWeights = new Map();  // peerId → { weights, samples, time }
    this.shareCount = 0;
    this.mergeCount = 0;
  }

  _ensureDirs() {
    try { if (!existsSync(MESH_DIR)) mkdirSync(MESH_DIR, { recursive: true }); } catch {}
    try { if (!existsSync(PEER_WEIGHTS_DIR)) mkdirSync(PEER_WEIGHTS_DIR, { recursive: true }); } catch {}
  }

  /**
   * 广播本地模型权重到全网
   */
  broadcastWeights(nn, samples) {
    if (!nn.W_i) return;
    const payload = {
      port: this.myPort,
      hiddenSize: nn.hiddenSize,
      samples,
      loss: nn.loss,
      W_i: nn.W_i, U_i: nn.U_i, b_i: nn.b_i,
      W_f: nn.W_f, U_f: nn.U_f, b_f: nn.b_f,
      W_c: nn.W_c, U_c: nn.U_c, b_c: nn.b_c,
      W_o: nn.W_o, U_o: nn.U_o, b_o: nn.b_o,
      W_out: nn.W_out, b_out: nn.b_out,
      charToIdx: [...nn.charToIdx.entries()],
      timestamp: Date.now()
    };

    try {
      this.p2p.broadcast('neural_share', payload);
      this.shareCount++;
      this._saveLocal(payload);
      console.log(`[NeuralMesh] 广播权重: ${samples}样本 loss=${nn.loss.toFixed(4)}`);
    } catch (e) {
      console.log(`[NeuralMesh] 广播失败: ${e.message}`);
    }
  }

  /**
   * 接收其他节点的权重并合并
   */
  receiveWeights(data) {
    if (!validateWeights(data)) {
      console.log(`[NeuralMesh] 拒绝无效权重 from port=${data?.port}`);
      return;
    }
    const rawPeerId = data.port || 'unknown';
    const peerId = sanitizePeerId(rawPeerId);
    this.peerWeights.set(peerId, data);
    this._savePeerWeights(peerId, data);
    console.log(`[NeuralMesh] 收到 ${peerId} 权重: ${data.samples}样本`);
  }

  /**
   * 把所有 peer 的权重加权平均合并到本地模型
   */
  mergeAll(nn) {
    if (this.peerWeights.size === 0) return 0;
    const peers = [...this.peerWeights.values()].filter(validateWeights);
    if (peers.length === 0) return 0;

    const localSamples = nn.samples || 0;
    let totalSamples = localSamples;
    for (const data of peers) totalSamples += data.samples || 0;
    if (totalSamples === 0) return 0;

    // 加权平均
    this._mergeMatrix(nn.W_i, peers, 'W_i', localSamples, totalSamples);
    this._mergeMatrix(nn.U_i, peers, 'U_i', localSamples, totalSamples);
    this._mergeMatrix(nn.W_f, peers, 'W_f', localSamples, totalSamples);
    this._mergeMatrix(nn.U_f, peers, 'U_f', localSamples, totalSamples);
    this._mergeMatrix(nn.W_c, peers, 'W_c', localSamples, totalSamples);
    this._mergeMatrix(nn.U_c, peers, 'U_c', localSamples, totalSamples);
    this._mergeMatrix(nn.W_o, peers, 'W_o', localSamples, totalSamples);
    this._mergeMatrix(nn.U_o, peers, 'U_o', localSamples, totalSamples);
    this._mergeMatrix(nn.W_out, peers, 'W_out', localSamples, totalSamples);
    this._mergeVector(nn.b_i, peers, 'b_i', localSamples, totalSamples);
    this._mergeVector(nn.b_f, peers, 'b_f', localSamples, totalSamples);
    this._mergeVector(nn.b_c, peers, 'b_c', localSamples, totalSamples);
    this._mergeVector(nn.b_o, peers, 'b_o', localSamples, totalSamples);
    this._mergeVector(nn.b_out, peers, 'b_out', localSamples, totalSamples);

    this.mergeCount++;
    console.log(`[NeuralMesh] 合并 ${peers.length} 节点权重 (${totalSamples}样本)`);
    return peers.length;
  }

  _mergeMatrix(local, peers, key, localSamples, totalSamples) {
    if (!local?.[0]) return;
    const localW = localSamples / totalSamples;
    for (let i = 0; i < local.length; i++)
      for (let j = 0; j < local[i].length; j++)
        local[i][j] *= localW;

    for (const data of peers) {
      const m = data[key];
      if (!m?.[0]) continue;
      const peerW = (data.samples || 1) / totalSamples;
      for (let i = 0; i < local.length; i++)
        for (let j = 0; j < local[i].length; j++)
          local[i][j] += (m[i]?.[j] || 0) * peerW;
    }
  }

  _mergeVector(local, peers, key, localSamples, totalSamples) {
    if (!local) return;
    const localW = localSamples / totalSamples;
    for (let i = 0; i < local.length; i++) local[i] *= localW;

    for (const data of peers) {
      const v = data[key];
      if (!v) continue;
      const peerW = (data.samples || 1) / totalSamples;
      for (let i = 0; i < local.length; i++)
        local[i] += (v[i] || 0) * peerW;
    }
  }

  _saveLocal(data) {
    try { writeFileSync(LOCAL_WEIGHTS, JSON.stringify(data)); } catch {}
  }

  _savePeerWeights(peerId, data) {
    try {
      const resolved = resolve(PEER_WEIGHTS_DIR, `${peerId}.json`);
      if (!resolved.startsWith(resolve(PEER_WEIGHTS_DIR) + sep)) {
        console.log(`[NeuralMesh] 路径穿越拒绝: ${peerId}`);
        return;
      }
      writeFileSync(resolved, JSON.stringify(data));
    } catch {}
  }

  getStats() {
    return {
      shareCount: this.shareCount,
      mergeCount: this.mergeCount,
      peers: this.peerWeights.size,
      totalPeerSamples: [...this.peerWeights.values()].reduce((s, d) => s + (d.samples || 0), 0)
    };
  }
}
