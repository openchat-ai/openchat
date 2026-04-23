/**
 * 语音网关 - AI Agent 实时语音通信
 *
 * 功能：
 * - AI Agent 语音房间管理
 * - WebRTC 信令处理
 * - 音频流转发 (SFU 模式)
 * - 语音转文字 (STT)
 * - 文字转语音 (TTS)
 */

const EventEmitter = require('events');
const crypto = require('crypto');

class VoiceGateway extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 8000;
    this.rooms = new Map();           // roomId -> room
    this.participants = new Map();    // participantId -> participant
    this.stunServers = options.stunServers || [
      'stun:stun.l.google.com:19302'
    ];
    this.turnServers = options.turnServers || [];

    // 音频配置
    this.audioConfig = {
      sampleRate: 16000,
      channels: 1,
      codec: 'opus',
      bitrate: 32000
    };
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
      isRecording: false,
      mode: options.mode || 'conference', // 'conference' | 'p2p'
      status: 'active',
      metadata: options.metadata || {}
    };

    this.rooms.set(roomId, room);
    this.emit('roomCreated', { roomId, room });

    return room;
  }

  /**
   * 加入房间
   */
  joinRoom(roomId, participant) {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error(`Room ${roomId} not found`);
    }

    if (room.participants.size >= room.maxParticipants) {
      throw new Error('Room is full');
    }

    const participantInfo = {
      id: participant.id || crypto.randomUUID(),
      roomId,
      agentId: participant.agentId,
      agentType: participant.agentType,
      role: participant.role || 'participant', // 'host' | 'participant' | 'listener'
      joinedAt: Date.now(),
      audioEnabled: true,
      speaking: false,
      volume: 0,
      audioStream: null,
      // STT/TTS
      sttEnabled: participant.sttEnabled !== false,
      ttsEnabled: participant.ttsEnabled !== false,
      lastTranscript: null
    };

    room.participants.add(participantInfo.id);
    this.participants.set(participantInfo.id, participantInfo);

    this.emit('participantJoined', { roomId, participant: participantInfo });

    return {
      roomId,
      participant: participantInfo,
      iceServers: this.getIceServers()
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
   * 处理 WebRTC 信令
   */
  handleSignaling(participantId, signal) {
    const participant = this.participants.get(participantId);
    if (!participant) {
      throw new Error('Participant not found');
    }

    const { type, data, targetId } = signal;

    switch (type) {
      case 'offer':
      case 'answer':
        // 转发给目标参与者
        if (targetId) {
          this.emit('signal', {
            from: participantId,
            to: targetId,
            type,
            data
          });
        }
        break;

      case 'ice-candidate':
        // ICE 候选交换
        if (targetId) {
          this.emit('iceCandidate', {
            from: participantId,
            to: targetId,
            candidate: data
          });
        }
        break;

      default:
        console.warn(`[VoiceGateway] Unknown signal type: ${type}`);
    }

    return { received: true };
  }

  /**
   * 转发音频流 (SFU 模式)
   */
  forwardAudio(fromParticipantId, audioData) {
    const participant = this.participants.get(fromParticipantId);
    if (!participant || !participant.audioEnabled) return;

    // 更新说话状态
    participant.speaking = true;
    participant.volume = audioData.volume || 0;

    const room = this.rooms.get(participant.roomId);
    if (!room) return;

    // 转发给房间内其他参与者
    for (const pid of room.participants) {
      if (pid !== fromParticipantId) {
        const target = this.participants.get(pid);
        if (target && target.audioEnabled) {
          this.emit('audioStream', {
            from: fromParticipantId,
            to: pid,
            audio: audioData,
            timestamp: Date.now()
          });
        }
      }
    }

    // 更新说话状态
    setTimeout(() => {
      participant.speaking = false;
    }, 500);
  }

  /**
   * 语音转文字 (STT)
   */
  async speechToText(audioData, participantId) {
    const participant = this.participants.get(participantId);
    if (!participant || !participant.sttEnabled) return null;

    // 这里应该集成实际的 STT 服务
    // 例如: Google Cloud Speech, Whisper, etc.
    const transcript = {
      text: '[STT Placeholder] 语音内容...',
      confidence: 0.9,
      timestamp: Date.now(),
      participantId
    };

    participant.lastTranscript = transcript;

    // 发送给房间内其他参与者
    const room = this.rooms.get(participant.roomId);
    if (room) {
      for (const pid of room.participants) {
        if (pid !== participantId) {
          this.emit('transcript', {
            roomId: room.id,
            transcript,
            participantId
          });
        }
      }
    }

    return transcript;
  }

  /**
   * 文字转语音 (TTS)
   */
  async textToSpeech(text, participantId, options = {}) {
    const participant = this.participants.get(participantId);
    if (!participant || !participant.ttsEnabled) return null;

    // 生成或获取 TTS 音频
    // 这里应该集成实际的 TTS 服务
    const audioData = {
      audio: Buffer.from('TTS_AUDIO_DATA'),
      format: 'opus',
      sampleRate: this.audioConfig.sampleRate,
      duration: options.duration || 1000
    };

    // 发送到房间
    const room = this.rooms.get(participant.roomId);
    if (room) {
      this.emit('ttsAudio', {
        roomId: room.id,
        from: participantId,
        text,
        audio: audioData
      });
    }

    return audioData;
  }

  /**
   * 切换模式：语音 <-> 文字
   */
  toggleMode(participantId, mode) {
    const participant = this.participants.get(participantId);
    if (!participant) return false;

    if (mode === 'text') {
      participant.sttEnabled = true;
      participant.ttsEnabled = true;
    } else {
      participant.sttEnabled = false;
      participant.ttsEnabled = false;
    }

    this.emit('modeChanged', { participantId, mode });
    return true;
  }

  /**
   * 获取 ICE 服务器配置
   */
  getIceServers() {
    return {
      iceServers: [
        ...this.stunServers.map(url => ({ urls: url })),
        ...this.turnServers.map(url => ({ urls: url, credential: '...' }))
      ]
    };
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
      participants: participants.map(p => ({
        id: p.id,
        agentId: p.agentId,
        agentType: p.agentType,
        role: p.role,
        speaking: p.speaking,
        sttEnabled: p.sttEnabled,
        ttsEnabled: p.ttsEnabled
      })),
      participantCount: participants.length
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
      createdAt: room.createdAt,
      status: room.status
    }));
  }

  /**
   * 结束房间
   */
  endRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // 通知所有参与者
    for (const pid of room.participants) {
      this.emit('roomEnded', { roomId, participantId: pid });
      this.participants.delete(pid);
    }

    this.rooms.delete(roomId);
    return true;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    let totalParticipants = 0;
    let speakingCount = 0;

    for (const room of this.rooms.values()) {
      totalParticipants += room.participants.size;
    }

    for (const p of this.participants.values()) {
      if (p.speaking) speakingCount++;
    }

    return {
      rooms: this.rooms.size,
      totalParticipants,
      speakingCount,
      activeRooms: Array.from(this.rooms.values()).filter(r => r.status === 'active').length
    };
  }
}

module.exports = { VoiceGateway };