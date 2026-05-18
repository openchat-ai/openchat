/**
 * 语音网关 - AI Agent 实时语音通信
 *
 * 支持多种传输模式:
 * - 原始 PCM (局域网)
 * - Neural Codec (AI压缩)
 * - Opus (标准压缩)
 * - 自适应 (根据网络自动切换)
 */

import { EventEmitter } from 'events';
import crypto from 'crypto';

let _neuralCodec = null;
async function _getNeuralCodec() {
  if (!_neuralCodec) {
    const { NeuralAudioCodec } = await import('./neural-audio-codec.js');
    _neuralCodec = new NeuralAudioCodec({ sampleRate: 24000, targetBitrate: 32 });
    await _neuralCodec.initialize();
  }
  return _neuralCodec;
}

class VoiceGateway extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 8000;
    this.rooms = new Map();
    this.participants = new Map();

    // 传输模式配置
    this.transportModes = {
      raw: { name: 'Raw PCM', bitrate: 256, quality: 100 },
      neural: { name: 'Neural Codec', bitrate: 32, quality: 90 },
      opus_high: { name: 'Opus HQ', bitrate: 128, quality: 75 },
      opus_low: { name: 'Opus Low', bitrate: 32, quality: 50 },
      adaptive: { name: 'Adaptive', bitrate: 'auto', quality: 'auto' }
    };

    // ICE 服务器
    this.stunServers = options.stunServers || [
      'stun:stun.l.google.com:19302'
    ];
    this.turnServers = options.turnServers || [];
  }

  /**
   * 创建语音房间
   */
  createRoom(options = {}) {
    const roomId = options.roomId || crypto.randomUUID();
    const room = {
      id: roomId,
      name: options.name || 'AI Discussion',
      createdAt: Date.now(),
      maxParticipants: options.maxParticipants || 10,
      participants: new Set(),
      // 传输模式: 'raw' | 'neural' | 'opus_high' | 'opus_low' | 'adaptive'
      transportMode: options.transportMode || 'adaptive',
      status: 'active'
    };

    this.rooms.set(roomId, room);
    this.emit('roomCreated', { roomId, room });

    return room;
  }

  /**
   * 设置房间传输模式
   */
  setRoomTransportMode(roomId, mode) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('Room not found');

    if (!this.transportModes[mode]) {
      throw new Error(`Unknown transport mode: ${mode}`);
    }

    room.transportMode = mode;

    // 通知所有参与者
    for (const pid of room.participants) {
      this.emit('transportModeChanged', { roomId, participantId: pid, mode });
    }

    return { roomId, mode, config: this.transportModes[mode] };
  }

  /**
   * 获取房间传输信息
   */
  getRoomTransportInfo(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const mode = room.transportMode;
    const config = this.transportModes[mode];

    // 计算预估流量
    const bitrate = typeof config.bitrate === 'number' ? config.bitrate : 0;
    const dailyMB = (bitrate * 3600 * 24) / 8 / 1000;

    return {
      roomId,
      mode,
      modeName: config.name,
      bitrate: config.bitrate,
      quality: `${config.quality}%`,
      dailyTraffic: `${dailyMB.toFixed(1)} MB`,
      description: config.description
    };
  }

  /**
   * 获取所有模式信息
   */
  getAllTransportModes() {
    return Object.entries(this.transportModes).map(([key, value]) => ({
      mode: key,
      ...value,
      dailyTraffic: `${((typeof value.bitrate === 'number' ? value.bitrate : 0) * 3600 * 24 / 8 / 1000).toFixed(1)} MB`
    }));
  }

  /**
   * 加入房间
   */
  joinRoom(roomId, participant) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    const participantInfo = {
      id: participant.id || crypto.randomUUID(),
      roomId,
      agentId: participant.agentId,
      agentType: participant.agentType,
      role: participant.role || 'participant',
      joinedAt: Date.now(),
      audioEnabled: true,
      speaking: false,
      volume: 0,
      // 传输信息
      transportMode: room.transportMode,
      bitrate: this.transportModes[room.transportMode]?.bitrate || 0
    };

    room.participants.add(participantInfo.id);
    this.participants.set(participantInfo.id, participantInfo);

    this.emit('participantJoined', { roomId, participant: participantInfo });

    return {
      roomId,
      participant: participantInfo,
      iceServers: this.getIceServers(),
      transportMode: room.transportMode,
      transportConfig: this.transportModes[room.transportMode]
    };
  }

  /**
   * 处理音频数据 (根据传输模式)
   */
  async processAudio(participantId, pcmData) {
    const participant = this.participants.get(participantId);
    if (!participant) return null;

    const room = this.rooms.get(participant.roomId);
    const mode = room?.transportMode || 'opus_low';

    let processedAudio;

    switch (mode) {
      case 'raw':
        // 直接传输 PCM
        processedAudio = {
          data: pcmData,
          method: 'raw',
          bitrate: 256
        };
        break;

      case 'neural': {
        try {
          const codec = await _getNeuralCodec();
          const encoded = await codec.encode(pcmData);
          processedAudio = {
            data: encoded.data,
            method: 'neural',
            bitrate: 32
          };
        } catch (err) {
          console.error('[VoiceGateway] Neural codec encode failed, falling back to raw:', err.message);
          processedAudio = {
            data: pcmData,
            method: 'raw',
            bitrate: 256
          };
        }
        break;
      }

      case 'opus_high':
      case 'opus_low':
        // Opus 压缩
        const bitrate = mode === 'opus_high' ? 128 : 32;
        processedAudio = {
          data: pcmData, // 实际会是压缩后的数据
          method: 'opus',
          bitrate
        };
        break;

      case 'adaptive':
        // 自适应: 由外部系统控制
        processedAudio = {
          data: pcmData,
          method: 'adaptive',
          bitrate: 'auto'
        };
        break;
    }

    // 转发给房间内其他参与者
    this.forwardAudio(participantId, processedAudio, room);

    return processedAudio;
  }

  /**
   * 转发音频
   */
  forwardAudio(fromParticipantId, audioData, room) {
    if (!room) return;

    for (const pid of room.participants) {
      if (pid !== fromParticipantId) {
        const target = this.participants.get(pid);
        if (target && target.audioEnabled) {
          this.emit('audioStream', {
            from: fromParticipantId,
            to: pid,
            audio: audioData,
            method: audioData.method,
            timestamp: Date.now()
          });
        }
      }
    }
  }

  /**
   * 获取 ICE 服务器配置
   */
  getIceServers() {
    return {
      iceServers: [
        ...this.stunServers.map(url => ({ urls: url })),
        ...this.turnServers.map(url => ({ urls: url, credential: 'placeholder' }))
      ]
    };
  }

  /**
   * 离开房间
   */
  leaveRoom(participantId) {
    const participant = this.participants.get(participantId);
    if (!participant) return false;

    const room = this.rooms.get(participant.roomId);
    if (room) {
      room.participants.delete(participantId);
      this.emit('participantLeft', { roomId: room.id, participantId });
    }

    this.participants.delete(participantId);
    return true;
  }

  /**
   * 获取房间信息
   */
  getRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const participants = Array.from(room.participants)
      .map(id => this.participants.get(id))
      .filter(p => p);

    return {
      ...room,
      transportInfo: this.getRoomTransportInfo(roomId),
      participants: participants.map(p => ({
        id: p.id,
        agentId: p.agentId,
        agentType: p.agentType,
        role: p.role,
        speaking: p.speaking,
        bitrate: p.bitrate
      }))
    };
  }

  /**
   * 获取所有房间
   */
  listRooms() {
    return Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      participantCount: room.participants.size,
      transportMode: room.transportMode,
      status: room.status
    }));
  }

  /**
   * 获取统计
   */
  getStats() {
    let totalParticipants = 0;
    const modeStats = {};

    // 统计各传输模式的使用情况
    for (const mode of Object.keys(this.transportModes)) {
      modeStats[mode] = 0;
    }

    for (const room of this.rooms.values()) {
      totalParticipants += room.participants.size;
      modeStats[room.transportMode] = (modeStats[room.transportMode] || 0) + room.participants.size;
    }

    return {
      rooms: this.rooms.size,
      totalParticipants,
      modeUsage: modeStats,
      availableModes: this.getAllTransportModes()
    };
  }
}

module.exports = { VoiceGateway };