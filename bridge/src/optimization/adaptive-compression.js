/**
 * 自适应压缩系统
 *
 * 功能：
 * - 自适应压缩选择
 * - 内容类型检测
 * - 压缩比评估
 * - 性能优化
 */

const zlib = require('zlib');

class AdaptiveCompressor {
  constructor(options = {}) {
    this.defaultAlgorithm = options.default || 'gzip';
    this.enableBrotli = options.enableBrotli !== false;
    this.minSizeForCompression = options.minSizeForCompression || 1024; // 1KB
    this.sampleSize = options.sampleSize || 8192;
    this.compressionStats = new Map();
    this.contentTypePatterns = {
      'text/': 'gzip',
      'application/json': 'gzip',
      'application/javascript': 'gzip',
      'application/xml': 'gzip',
      'application/zip': 'none',
      'image/': 'none',
      'audio/': 'none',
      'video/': 'none'
    };
  }

  /**
   * 压缩数据（自适应选择算法）
   */
  async compress(data, options = {}) {
    const { contentType = 'application/octet-stream', forceAlgorithm = null } = options;

    // 小数据不压缩
    const dataSize = Buffer.isBuffer(data) ? data.length : JSON.stringify(data).length;
    if (dataSize < this.minSizeForCompression) {
      return {
        data,
        algorithm: 'none',
        originalSize: dataSize,
        compressedSize: dataSize,
        ratio: 1,
        reason: 'Too small'
      };
    }

    // 强制算法
    if (forceAlgorithm) {
      return this.compressWith(data, forceAlgorithm, dataSize);
    }

    // 根据内容类型选择
    const suggestedAlgorithm = this.suggestAlgorithm(contentType);
    const algorithmStats = this.compressionStats.get(suggestedAlgorithm);

    // 检查是否需要尝试更好的算法
    const result = await this.compressWith(data, suggestedAlgorithm, dataSize);

    // 如果压缩比不佳，尝试其他算法
    if (result.ratio > 0.8 && this.enableBrotli && suggestedAlgorithm !== 'brotli') {
      const brotliResult = await this.compressWith(data, 'brotli', dataSize);
      if (brotliResult.ratio < result.ratio) {
        return brotliResult;
      }
    }

    // 记录统计
    this.recordCompression(suggestedAlgorithm, result.ratio);

    return result;
  }

  /**
   * 使用指定算法压缩
   */
  async compressWith(data, algorithm, originalSize) {
    const input = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));

    let compressed;
    let startTime = Date.now();

    try {
      switch (algorithm) {
        case 'gzip':
          compressed = zlib.gzipSync(input);
          break;
        case 'brotli':
          if (zlib.createBrotliCompress) {
            compressed = zlib.brotliCompressSync(input);
          } else {
            compressed = zlib.gzipSync(input);
          }
          break;
        case 'deflate':
          compressed = zlib.deflateSync(input);
          break;
        case 'none':
        default:
          compressed = input;
          algorithm = 'none';
      }
    } catch (error) {
      console.error(`[AdaptiveCompressor] Compression error: ${error.message}`);
      compressed = input;
      algorithm = 'none';
    }

    const compressionTime = Date.now() - startTime;
    const compressedSize = compressed.length;
    const ratio = compressedSize / originalSize;

    return {
      data: compressed,
      algorithm,
      originalSize,
      compressedSize,
      ratio,
      compressionTime,
      reason: ratio < 1 ? 'Compressed' : 'No benefit'
    };
  }

  /**
   * 解压数据
   */
  decompress(data, algorithm = null) {
    if (!algorithm) {
      // 尝试自动检测
      algorithm = this.detectAlgorithm(data);
    }

    try {
      switch (algorithm) {
        case 'gzip':
          return zlib.gunzipSync(data);
        case 'brotli':
          if (zlib.createBrotliDecompress) {
            return zlib.brotliDecompressSync(data);
          }
          return data;
        case 'deflate':
          return zlib.inflateSync(data);
        case 'none':
        default:
          return data;
      }
    } catch (error) {
      console.error(`[AdaptiveCompressor] Decompression error: ${error.message}`);
      return data;
    }
  }

  /**
   * 建议算法
   */
  suggestAlgorithm(contentType) {
    for (const [pattern, algorithm] of Object.entries(this.contentTypePatterns)) {
      if (contentType.includes(pattern)) {
        return algorithm;
      }
    }
    return this.defaultAlgorithm;
  }

  /**
   * 检测压缩算法
   */
  detectAlgorithm(data) {
    // 简单检测：检查文件头
    if (data[0] === 0x1f && data[1] === 0x8b) return 'gzip';
    if (data[0] === 0x00 && data[1] === 0x00) return 'brotli'; // 简化
    return this.defaultAlgorithm;
  }

  /**
   * 记录压缩统计
   */
  recordCompression(algorithm, ratio) {
    if (!this.compressionStats.has(algorithm)) {
      this.compressionStats.set(algorithm, {
        count: 0,
        totalRatio: 0,
        avgRatio: 0
      });
    }

    const stats = this.compressionStats.get(algorithm);
    stats.count++;
    stats.totalRatio += ratio;
    stats.avgRatio = stats.totalRatio / stats.count;
  }

  /**
   * 获取最佳算法
   */
  getBestAlgorithm() {
    let best = { algorithm: this.defaultAlgorithm, avgRatio: 1 };
    const stats = this.compressionStats;

    for (const [algorithm, data] of stats) {
      if (data.avgRatio < best.avgRatio) {
        best = { algorithm, avgRatio: data.avgRatio };
      }
    }

    return best;
  }

  /**
   * 获取压缩统计
   */
  getStats() {
    const stats = {};
    for (const [algorithm, data] of this.compressionStats) {
      stats[algorithm] = {
        count: data.count,
        avgRatio: Math.round(data.avgRatio * 100) / 100
      };
    }
    return {
      algorithms: stats,
      bestAlgorithm: this.getBestAlgorithm(),
      defaultAlgorithm: this.defaultAlgorithm
    };
  }

  /**
   * 批量压缩
   */
  async compressBatch(items, options = {}) {
    const results = [];
    for (const item of items) {
      const result = await this.compress(item.data, {
        ...options,
        contentType: item.contentType
      });
      results.push({
        key: item.key,
        ...result
      });
    }
    return results;
  }

  /**
   * 预估压缩比（不实际压缩）
   */
  estimateCompressionRatio(data) {
    const size = Buffer.isBuffer(data) ? data.length : JSON.stringify(data).length;

    if (size < this.minSizeForCompression) {
      return { estimated: 1, reason: 'Too small' };
    }

    // 简单预估：基于数据特征
    let estimated = 0.5; // 默认预估
    let uniqueness = 0;

    // 检查是否是重复数据
    const str = data.toString();
    if (str.length > 100) {
      const uniqueChars = new Set(str).size;
      uniqueness = uniqueChars / str.length;
      estimated = 0.3 + (uniqueness * 0.5);
    }

    return {
      estimated: Math.max(0.1, Math.min(1, estimated)),
      reason: uniqueness > 0.8 ? 'High redundancy' : 'Normal'
    };
  }
}

module.exports = { AdaptiveCompressor };