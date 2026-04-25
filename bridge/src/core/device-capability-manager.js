/**
 * 设备算力管理器
 *
 * 功能:
 * - 检测设备算力 (CPU/GPU/NPU)
 * - 存储设备能力信息
 * - 根据双方算力选择最佳传输方案
 */

const os = require('os');
const EventEmitter = require('events');

class DeviceCapabilityManager extends EventEmitter {
  constructor(options = {}) {
    super();

    // 本地设备 (Bridge) 算力
    this.localDevice = null;

    // 远程设备 (手机) 算力
    this.remoteDevices = new Map();

    // 算力等级阈值
    this.thresholds = {
      // TOPS 阈值
      npu: {
        weak: 1,      // < 1 TOPS
        normal: 10,   // 1-10 TOPS
        strong: 30,   // 10-30 TOPS
        ultra: 50     // > 50 TOPS
      },
      // 内存阈值 (GB)
      memory: {
        low: 2,
        medium: 4,
        high: 8,
        ultra: 16
      }
    };

    console.log('[DeviceCapability] Manager initialized');
  }

  /**
   * 初始化并检测本地算力
   */
  async initialize() {
    console.log('[DeviceCapability] Detecting local device...');

    this.localDevice = await this.detectLocalCapability();

    console.log('[DeviceCapability] Local device:', {
      name: this.localDevice.name,
      type: this.localDevice.type,
      totalTOPS: this.localDevice.totalTOPS,
      memoryGB: this.localDevice.memoryGB
    });

    return this.localDevice;
  }

  /**
   * 检测本地设备 (Bridge服务器) 算力
   */
  async detectLocalCapability() {
    const cpus = os.cpus();
    const totalMemoryGB = os.totalmem() / (1024 * 1024 * 1024);
    const freeMemoryGB = os.freemem() / (1024 * 1024 * 1024);

    // CPU 核心数和频率
    const cpuModel = cpus[0]?.model || 'Unknown';
    const cpuCores = cpus.length;
    const cpuSpeedMHz = cpus[0]?.speed || 0;

    // 估算 CPU 算力 (简化)
    const cpuScore = cpuCores * (cpuSpeedMHz / 1000) * 0.1;

    // GPU 算力 (如果有) - 通过系统信息检测
    const gpuInfo = await this.detectGPU();

    // 总算力
    const totalTOPS = cpuScore + gpuInfo.toast;

    // 设备类型
    const type = this.detectDeviceType();

    return {
      id: 'local-bridge',
      name: os.hostname(),
      type,
      platform: process.platform,
      cpu: {
        model: cpuModel,
        cores: cpuCores,
        speedMHz: cpuSpeedMHz,
        score: cpuScore
      },
      gpu: gpuInfo,
      memory: {
        totalGB: totalMemoryGB,
        freeGB: freeMemoryGB,
        usedPercent: ((totalMemoryGB - freeMemoryGB) / totalMemoryGB * 100).toFixed(1)
      },
      totalTOPS: Math.round(totalTOPS * 10) / 10,
      powerStatus: 'plugged', // 服务器总是插电
      timestamp: Date.now()
    };
  }

  /**
   * 检测 GPU
   */
  async detectGPU() {
    // 简化版: 尝试检测常见 GPU
    // 实际应使用系统 API 或库

    const platform = process.platform;

    // 模拟 GPU 检测
    // 实际会用: nvidia-smi, system_profiler, 等

    return {
      name: 'Unknown',
      vramGB: 0,
      tops: 0,
      available: false
    };
  }

  /**
   * 检测设备类型
   */
  detectDeviceType() {
    const platform = process.platform;

    if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
      // 检测是否为树莓派等小型设备
      const hostname = os.hostname().toLowerCase();
      if (hostname.includes('raspberry') || hostname.includes('pi')) {
        return 'single-board-computer';
      }

      // 假设是服务器/电脑
      return 'server';
    }

    return 'unknown';
  }

  /**
   * 注册远程设备 (手机)
   */
  registerRemoteDevice(deviceInfo) {
    const { deviceId } = deviceInfo;

    // 合并设备信息
    const device = {
      ...deviceInfo,
      registeredAt: Date.now(),
      lastSeen: Date.now()
    };

    this.remoteDevices.set(deviceId, device);

    console.log('[DeviceCapability] Remote device registered:', {
      deviceId: device.deviceId,
      type: device.type,
      totalTOPS: device.totalTOPS
    });

    // 触发方案重新评估
    this.emit('deviceRegistered', { deviceId, device });

    return device;
  }

  /**
   * 更新远程设备状态
   */
  updateRemoteDevice(deviceId, updates) {
    const device = this.remoteDevices.get(deviceId);
    if (!device) return null;

    const updated = { ...device, ...updates, lastSeen: Date.now() };
    this.remoteDevices.set(deviceId, updated);

    return updated;
  }

  /**
   * 移除远程设备
   */
  removeRemoteDevice(deviceId) {
    const removed = this.remoteDevices.delete(deviceId);
    if (removed) {
      this.emit('deviceRemoved', { deviceId });
    }
    return removed;
  }

  /**
   * 获取设备算力等级
   */
  getCapabilityLevel(device) {
    const { totalTOPS, memoryGB, powerStatus } = device;

    let level = 'weak';

    // 根据算力分级
    if (totalTOPS >= this.thresholds.npu.ultra) {
      level = 'ultra';
    } else if (totalTOPS >= this.thresholds.npu.strong) {
      level = 'strong';
    } else if (totalTOPS >= this.thresholds.npu.normal) {
      level = 'normal';
    }

    // 电量影响
    if (device.type === 'mobile') {
      if (powerStatus === 'low') {
        level = this.downgradeLevel(level, 2);
      } else if (powerStatus === 'normal') {
        level = this.downgradeLevel(level, 1);
      }
    }

    return level;
  }

  /**
   * 降级算力等级
   */
  downgradeLevel(level, steps) {
    const levels = ['weak', 'normal', 'strong', 'ultra'];
    const currentIndex = levels.indexOf(level);
    const newIndex = Math.max(0, currentIndex - steps);
    return levels[newIndex];
  }

  /**
   * 选择最佳传输方案
   */
  selectOptimalTransportScheme(remoteDeviceId) {
    const remote = this.remoteDevices.get(remoteDeviceId);
    const local = this.localDevice;

    if (!remote || !local) {
      return { error: 'Device not found', scheme: 'opus_low' };
    }

    const remoteLevel = this.getCapabilityLevel(remote);
    const localLevel = this.getCapabilityLevel(local);

    console.log('[DeviceCapability] Capability levels:', {
      remote: remoteLevel,
      local: localLevel
    });

    // 根据双方算力选择方案
    let scheme;
    let reason;

    // 方案选择逻辑
    if (localLevel === 'ultra' && remoteLevel === 'ultra') {
      // 都很强: 用 Neural Codec
      scheme = 'neural';
      reason = 'Both devices have strong NPU';
    } else if (localLevel === 'ultra') {
      // 本地强: 云端编码
      scheme = 'neural_cloud_encode';
      reason = 'Local (Bridge) is strong, encoding on server';
    } else if (remoteLevel === 'ultra') {
      // 远程强: 本地编码
      scheme = 'neural';
      reason = 'Remote device is strong, encoding locally';
    } else if (localLevel === 'strong' || remoteLevel === 'strong') {
      // 至少一方较强: Neural Codec 低码率
      scheme = 'neural';
      reason = 'At least one device is strong';
    } else {
      // 都较弱: 用 Opus
      scheme = 'opus_low';
      reason = 'Both devices are weak, using standard compression';
    }

    // 电量考虑
    if (remote.powerStatus === 'low') {
      scheme = 'opus_low';
      reason += ', downgraded due to low battery';
    }

    return {
      scheme,
      reason,
      localCapability: localLevel,
      remoteCapability: remoteLevel,
      recommendedBitrate: this.getRecommendedBitrate(scheme, remoteLevel)
    };
  }

  /**
   * 获取推荐码率
   */
  getRecommendedBitrate(scheme, level) {
    const bitrates = {
      neural: {
        weak: 8,
        normal: 16,
        strong: 32,
        ultra: 50
      },
      opus_high: {
        weak: 32,
        normal: 64,
        strong: 128,
        ultra: 256
      },
      opus_low: {
        weak: 16,
        normal: 24,
        strong: 32,
        ultra: 48
      }
    };

    return bitrates[scheme]?.[level] || 32;
  }

  /**
   * 获取所有设备信息
   */
  getAllDevices() {
    return {
      local: this.localDevice,
      remote: Array.from(this.remoteDevices.values()),
      summary: {
        localLevel: this.localDevice ? this.getCapabilityLevel(this.localDevice) : 'unknown',
        remoteCount: this.remoteDevices.size,
        remoteLevels: Array.from(this.remoteDevices.values()).map(d => ({
          id: d.deviceId,
          level: this.getCapabilityLevel(d)
        }))
      }
    };
  }

  /**
   * 清理超时设备
   */
  cleanupTimeoutDevices(timeoutMs = 60000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [deviceId, device] of this.remoteDevices) {
      if (now - device.lastSeen > timeoutMs) {
        this.remoteDevices.delete(deviceId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[DeviceCapability] Cleaned ${cleaned} timeout devices`);
    }

    return cleaned;
  }
}

module.exports = { DeviceCapabilityManager };