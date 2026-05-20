/**
 * Network Type Detector
 * 检测网络类型：WiFi vs Mobile
 */

const os = require('os');

class NetworkDetector {
  constructor(options = {}) {
    this.checkInterval = options.checkInterval || 60000; // 1 分钟
    this.lastNetworkType = 'unknown';
    this.checkTimer = null;
    this.listeners = [];
  }

  /**
   * 开始检测网络类型
   */
  start() {
    this.detect(); // 立即检测一次
    this.checkTimer = setInterval(() => this.detect(), this.checkInterval);
    console.log('[NetworkDetector] Started');
  }

  /**
   * 停止检测
   */
  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    console.log('[NetworkDetector] Stopped');
  }

  /**
   * 检测当前网络类型
   */
  detect() {
    const networkType = this.detectNetworkType();
    const previousType = this.lastNetworkType;

    if (networkType !== previousType) {
      this.lastNetworkType = networkType;
      console.log(`[NetworkDetector] Network changed: ${previousType} -> ${networkType}`);

      // 通知监听器
      this.notifyListeners({
        previous: previousType,
        current: networkType,
        timestamp: Date.now()
      });
    }

    return networkType;
  }

  /**
   * 检测网络类型
   */
  detectNetworkType() {
    // 简化实现：基于平台判断
    const platform = process.platform;

    // 在移动设备上运行
    if (platform === 'android' || platform === 'ios') {
      return 'Mobile';
    }

    // 检查网络接口
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // 跳过内部地址和非 IPv4
        if (iface.internal || iface.family !== 'IPv4') continue;

        // 检查接口名称
        if (name.toLowerCase().includes('wi-fi') || name.toLowerCase().includes('wifi') || name.toLowerCase().includes('wlan')) {
          return 'WiFi';
        }
        if (name.toLowerCase().includes('cellular') || name.toLowerCase().includes('mobile') || name.toLowerCase().includes('data')) {
          return 'Mobile';
        }
      }
    }

    // 默认返回 WiFi（假设桌面环境通常在 WiFi 或有线网络）
    return 'WiFi';
  }

  /**
   * 检测网络Metered状态（流量计费）
   */
  detectMetered() {
    // 简化实现：默认非计量
    // 实际应该检查系统 API
    const platform = process.platform;

    // 移动设备默认可能是计量网络
    if (platform === 'android' || platform === 'ios') {
      return true;
    }

    return false;
  }

  /**
   * 获取网络信息
   */
  getNetworkInfo() {
    return {
      type: this.lastNetworkType,
      metered: this.detectMetered(),
      timestamp: Date.now()
    };
  }

  /**
   * 注册监听器
   */
  onNetworkChange(callback) {
    this.listeners.push(callback);
  }

  /**
   * 通知监听器
   */
  notifyListeners(change) {
    for (const callback of this.listeners) {
      try {
        callback(change);
      } catch (error) {
        console.error('[NetworkDetector] Listener error:', error.message);
      }
    }
  }
}

module.exports = NetworkDetector;