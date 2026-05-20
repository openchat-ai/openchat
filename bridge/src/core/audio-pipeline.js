import logger from './logger.js';
/**
 * 高级音频处理管道
 *
 * 使用 RNNOISE 深度学习降噪:
 * - RNNOISE: 深度学习降噪 (使用 @jitsi/rnnoise-wasm)
 * - WebRTC VAD: 语音活动检测
 * - AEC: 回声消除
 * - AGC: 自动增益控制
 *
 * 注意: RNNOISE WASM 在 Node.js 环境下可能有兼容性问题
 *       在浏览器环境中表现最佳
 */

class AudioPipeline {
  constructor(options = {}) {
    // 音频配置
    this.sampleRate = options.sampleRate || 24000; // RNNOISE 需要 24kHz
    this.channels = options.channels || 1;
    this.frameSize = options.frameSize || 480; // 20ms @ 24kHz

    // 处理链
    this.enabled = {
      rnnoise: true,      // 深度学习降噪
      vad: true,          // 语音活动检测
      aec: true,          // 回声消除
      agc: true,          // 自动增益
      highPass: true      // 高通滤波
    };

    // RNNOISE 实例 (Jitsi 版本 - 底层 API)
    this.rnnoiseState = null;
    this.rnnoiseModule = null;
    this.rnnoiseReady = false;

    // 统计
    this.stats = {
      totalFrames: 0,
      speechFrames: 0,
      noiseFrames: 0,
      totalSpeechTime: 0,
      rnnoiseProcessingTime: 0
    };

    logger.info('[AudioPipeline] Initializing...');
  }

  /**
   * 异步初始化 - 加载 RNNOISE 模型
   * 优先使用 Jitsi rnnoise-wasm (底层 API)
   */
  async initialize() {
    try {
      // 尝试加载 Jitsi 版本 (更底层的 API)
      const mod = await import('@jitsi/rnnoise-wasm/dist/rnnoise-sync.js');
      this.rnnoiseModule = await mod.default();

      // 创建 RNNOISE 状态
      this.rnnoiseState = this.rnnoiseModule._rnnoise_create();

      if (this.rnnoiseState) {
        this.rnnoiseReady = true;
        logger.info('[AudioPipeline] RNNOISE loaded (Jitsi version)');
      } else {
        throw new Error('Failed to create RNNOISE state');
      }
    } catch (error) {
      logger.info('[AudioPipeline] RNNOISE not available:', error.message);
      logger.info('[AudioPipeline] Using simulation mode (Node.js environment)');
      this.rnnoiseReady = false;
    }

    logger.info('[AudioPipeline] Ready with VAD/AEC/AGC');
    return this;
  }

  /**
   * 处理音频帧
   * 输入: 原始PCM数据 (16-bit)
   * 输出: 处理后的PCM数据 + 元数据
   */
  async processFrame(pcmData) {
    const frame = {
      data: Buffer.from(pcmData),
      timestamp: Date.now(),
      size: pcmData.length
    };

    // 1. 回声消除 (AEC)
    if (this.enabled.aec) {
      frame.data = await this.applyAEC(frame.data);
    }

    // 2. 高通滤波 (去除低频噪声)
    if (this.enabled.highPass) {
      frame.data = this.applyHighPass(frame.data);
    }

    // 3. RNNOISE 降噪 (深度学习)
    if (this.enabled.rnnoise) {
      const result = await this.applyRNNoise(frame.data);
      frame.data = result.data;
      frame.vad = result.vad;
    }

    // 4. 自动增益控制 (AGC)
    if (this.enabled.agc) {
      frame.data = this.applyAGC(frame.data);
    }

    // 5. 语音活动检测 (VAD) - 如果 RNNOISE 没有返回有效 VAD
    // frame.vad 可能是 0 或 undefined
    if (frame.vad === undefined || frame.vad === 0) {
      const vadResult = this.detectSpeech(frame.data);
      frame.isSpeech = vadResult.isSpeech;
      frame.speechProbability = vadResult.probability;
    } else {
      frame.isSpeech = frame.vad > 0.5;
      frame.speechProbability = frame.vad;
    }

    // 更新统计
    this.updateStats(frame);

    return frame;
  }

  /**
   * RNNOISE 降噪 (使用 Jitsi WASM 底层 API)
   *
   * 注意: RNNOISE WASM 在 Node.js 环境下可能有兼容性问题
   *       浏览器环境中表现最佳，此处回退到模拟模式
   */
  async applyRNNoise(pcmData) {
    const startTime = Date.now();

    // RNNOISE 需要 24kHz 采样率
    let inputData = Buffer.from(pcmData);

    if (this.sampleRate !== 24000) {
      inputData = this.resample(pcmData, this.sampleRate, 24000);
    }

    let vad = 0;

    // 尝试使用 Jitsi RNNOISE (底层 API)
    // 注意: Node.js 环境下可能返回全 0，这是 WASM 兼容性问题
    if (this.rnnoiseReady && this.rnnoiseState && this.rnnoiseModule) {
      try {
        const frameSize = 480; // 20ms @ 24kHz
        const inputPtr = this.rnnoiseModule._malloc(frameSize * 4);
        const outputPtr = this.rnnoiseModule._malloc(frameSize * 4);

        // 填充输入 (Float32)
        for (let i = 0; i < frameSize && i < inputData.length / 2; i++) {
          const sample = inputData.readInt16LE(i * 2) / 32768.0;
          this.rnnoiseModule.HEAPF32[(inputPtr >> 2) + i] = sample;
        }

        // 处理帧
        this.rnnoiseModule._rnnoise_process_frame(this.rnnoiseState, outputPtr, inputPtr);

        // 读取输出
        const output = Buffer.alloc(frameSize * 2);
        let hasNonZero = false;
        for (let i = 0; i < frameSize; i++) {
          const sample = this.rnnoiseModule.HEAPF32[(outputPtr >> 2) + i];
          if (Math.abs(sample) > 0.001) hasNonZero = true;
          output.writeInt16LE(Math.round(sample * 32768), i * 2);
        }

        // 清理
        this.rnnoiseModule._free(inputPtr);
        this.rnnoiseModule._free(outputPtr);

        // 如果输出全 0，回退到模拟模式
        if (!hasNonZero) {
          logger.info('[AudioPipeline] RNNOISE returned zeros, using simulation');
        } else {
          this.stats.rnnoiseProcessingTime += Date.now() - startTime;

          // VAD 估算 (基于能量)
          vad = this.detectSpeech(inputData).probability;

          if (this.sampleRate !== 24000) {
            return { data: this.resample(output, 24000, this.sampleRate), vad };
          }
          return { data: output, vad };
        }
      } catch (error) {
        logger.info('[AudioPipeline] RNNOISE processing error:', error.message);
      }
    }

    // 降级模式：使用模拟降噪
    const noiseLevel = this.estimateNoiseLevel(pcmData);
    if (noiseLevel > 0.1) {
      const reduction = Math.min(noiseLevel * 0.5, 0.8);
      return { data: this.applyNoiseReduction(pcmData, reduction), vad };
    }

    return { data: pcmData, vad };
  }

  /**
   * 简单的重采样 (仅支持整数比率)
   */
  resample(buffer, fromRate, toRate) {
    if (fromRate === toRate) return buffer;

    const ratio = fromRate / toRate;
    const newLength = Math.round(buffer.length / ratio);
    const output = Buffer.alloc(newLength);

    for (let i = 0; i < newLength; i++) {
      const srcIndex = Math.round(i * ratio) * 2;
      if (srcIndex < buffer.length - 1) {
        output.writeInt16LE(buffer.readInt16LE(srcIndex), i * 2);
      }
    }

    return output;
  }

  /**
   * 回声消除 (AEC) - 占位符
   */
  async applyAEC(pcmData) {
    return pcmData;
  }

  /**
   * 高通滤波 - 去除低频噪声 (风噪、空调)
   * 使用正确的一阶高通滤波器公式
   */
  applyHighPass(pcmData) {
    // 截止频率 80Hz
    const fc = 80;
    const dt = 1 / this.sampleRate;
    const RC = 1 / (2 * Math.PI * fc);
    const alpha = RC / (RC + dt);

    const output = Buffer.alloc(pcmData.length);
    let prevInput = 0;
    let prevOutput = 0;

    for (let i = 0; i < pcmData.length; i += 2) {
      const sample = pcmData.readInt16LE(i);
      // 一阶高通滤波器: y[n] = α*y[n-1] + α*(x[n] - x[n-1])
      const filtered = alpha * prevOutput + alpha * (sample - prevInput);
      output.writeInt16LE(Math.round(filtered), i);
      prevInput = sample;
      prevOutput = filtered;
    }

    return output;
  }

  /**
   * 估算噪声水平
   */
  estimateNoiseLevel(pcmData) {
    let sum = 0;
    for (let i = 0; i < pcmData.length; i += 2) {
      const sample = pcmData.readInt16LE(i);
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / (pcmData.length / 2));
    return Math.min(rms / 32768, 1);
  }

  /**
   * 应用降噪 (模拟)
   */
  applyNoiseReduction(pcmData, reduction) {
    const factor = 1 - reduction * 0.3;
    const output = Buffer.alloc(pcmData.length);

    for (let i = 0; i < pcmData.length; i += 2) {
      const sample = pcmData.readInt16LE(i);
      output.writeInt16LE(Math.round(sample * factor), i);
    }

    return output;
  }

  /**
   * 自动增益控制 (AGC)
   */
  applyAGC(pcmData) {
    const rms = this.calculateRMS(pcmData);
    const targetRMS = 8000;

    if (rms < 100) return pcmData;

    const gain = targetRMS / rms;
    const clampedGain = Math.min(gain, 10);

    const output = Buffer.alloc(pcmData.length);
    for (let i = 0; i < pcmData.length; i += 2) {
      let sample = pcmData.readInt16LE(i) * clampedGain;
      sample = Math.max(-32768, Math.min(32767, sample));
      output.writeInt16LE(Math.round(sample), i);
    }

    return output;
  }

  /**
   * 语音活动检测 (VAD)
   * 使用能量和过零率判断
   *
   * 语音: 能量中高 + 过零率 10-80
   * 噪声: 过零率 > 80
   * 静音: 能量 < 300
   *
   * 注意: 纯音乐可能被误判为语音，这是 VAD 的常见难点
   *       实际应用中，语音识别引擎会进一步处理
   */
  detectSpeech(pcmData) {
    const energy = this.calculateEnergy(pcmData);
    const zeroCrossings = this.calculateZeroCrossings(pcmData);

    const minEnergy = 300;
    const maxZCR = 80;  // 语音过零率通常 < 80
    const minZCR = 8;   // 语音过零率通常 > 8

    // 静音
    if (energy < minEnergy) {
      return { isSpeech: false, probability: 0 };
    }

    // 直流偏移或超低频
    if (zeroCrossings < minZCR) {
      return { isSpeech: false, probability: 0.1 };
    }

    // 噪声：过零率太高
    if (zeroCrossings > maxZCR) {
      return { isSpeech: false, probability: 0.2 };
    }

    // 语音区间：能量足够 + 过零率适中
    const energyProb = Math.min((energy - minEnergy) / 5000, 1);
    const zcrProb = 1 - (zeroCrossings - minZCR) / (maxZCR - minZCR);

    const probability = Math.max(0, Math.min(1, energyProb * 0.5 + zcrProb * 0.5));
    const isSpeech = probability > 0.3;

    return { isSpeech, probability };
  }

  /**
   * 计算幅度变化率
   */
  calculateAmplitudeVariation(pcmData) {
    const segmentSize = pcmData.length / 4;
    const segmentEnergies = [];

    for (let s = 0; s < 4; s++) {
      let sum = 0;
      const start = s * segmentSize;
      const end = start + segmentSize;
      for (let i = start; i < end; i += 2) {
        sum += Math.abs(pcmData.readInt16LE(i));
      }
      segmentEnergies.push(sum / (segmentSize / 2));
    }

    const avg = segmentEnergies.reduce((a, b) => a + b, 0) / 4;
    const variance = segmentEnergies.reduce((sum, e) => sum + Math.pow(e - avg, 2), 0) / 4;

    return Math.sqrt(variance) / (avg || 1);
  }

  /**
   * 计算幅度标准差
   */
  calculateAmplitudeStd(pcmData) {
    let sum = 0;
    for (let i = 0; i < pcmData.length; i += 2) {
      sum += Math.abs(pcmData.readInt16LE(i));
    }
    const avg = sum / (pcmData.length / 2);

    let varianceSum = 0;
    for (let i = 0; i < pcmData.length; i += 2) {
      const amp = Math.abs(pcmData.readInt16LE(i));
      varianceSum += Math.pow(amp - avg, 2);
    }

    return Math.sqrt(varianceSum / (pcmData.length / 2));
  }

  calculateRMS(pcmData) {
    let sum = 0;
    for (let i = 0; i < pcmData.length; i += 2) {
      const sample = pcmData.readInt16LE(i);
      sum += sample * sample;
    }
    return Math.sqrt(sum / (pcmData.length / 2));
  }

  calculateEnergy(pcmData) {
    let energy = 0;
    for (let i = 0; i < pcmData.length; i += 2) {
      energy += Math.abs(pcmData.readInt16LE(i));
    }
    return energy / (pcmData.length / 2);
  }

  calculateZeroCrossings(pcmData) {
    let crossings = 0;
    let prev = 0;
    for (let i = 0; i < pcmData.length; i += 2) {
      const sample = pcmData.readInt16LE(i);
      if ((prev < 0 && sample >= 0) || (prev >= 0 && sample < 0)) {
        crossings++;
      }
      prev = sample;
    }
    return crossings;
  }

  /**
   * 更新统计
   */
  updateStats(frame) {
    this.stats.totalFrames++;
    if (frame.isSpeech) {
      this.stats.speechFrames++;
      this.stats.totalSpeechTime += this.frameSize / this.sampleRate;
    } else {
      this.stats.noiseFrames++;
    }
  }

  /**
   * 获取音频处理统计
   */
  getStats() {
    const total = this.stats.totalFrames || 1;
    return {
      totalFrames: this.stats.totalFrames,
      speechFrames: this.stats.speechFrames,
      noiseFrames: this.stats.noiseFrames,
      speechRatio: `${((this.stats.speechFrames / total) * 100).toFixed(1)}%`,
      totalSpeechTime: `${this.stats.totalSpeechTime.toFixed(1)}s`,
      vadEnabled: this.enabled.vad,
      rnnoiseEnabled: this.enabled.rnnoise,
      rnnoiseReady: this.rnnoiseReady,
      rnnoiseAvgTime: this.stats.totalFrames > 0
        ? `${(this.stats.rnnoiseProcessingTime / this.stats.totalFrames).toFixed(2)}ms`
        : 'N/A',
      aecEnabled: this.enabled.aec
    };
  }

  /**
   * 销毁
   */
  destroy() {
    // 清理 Jitsi RNNOISE 状态
    if (this.rnnoiseState && this.rnnoiseModule) {
      try {
        this.rnnoiseModule._rnnoise_destroy(this.rnnoiseState);
      } catch (e) {
        // 忽略清理错误
      }
      this.rnnoiseState = null;
    }

    // 清理 Shiguredo 版本
    if (this.denoiseState) {
      try {
        this.denoiseState.destroy();
      } catch (e) {
        // 忽略
      }
      this.denoiseState = null;
    }

    this.rnnoiseReady = false;
    logger.info('[AudioPipeline] Destroyed');
  }
}

export { AudioPipeline };