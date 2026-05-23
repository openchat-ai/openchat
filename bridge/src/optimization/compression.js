/**
 * Compression Manager
 * 传输层压缩（gzip/brotli）- 简化版
 */

const zlib = require('zlib');

class CompressionManager {
  constructor(options = {}) {
    this.defaultAlgorithm = options.default || 'gzip';
    this.enabled = true;

    console.log(`[Compression] Manager initialized with ${this.defaultAlgorithm}`);
  }

  /**
   * 压缩数据
   */
  compress(data, algorithm = null) {
    if (!this.enabled) {
      return Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
    }

    algorithm = algorithm || this.defaultAlgorithm;

    try {
      const input = Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));

      switch (algorithm) {
        case 'gzip':
          return zlib.gzipSync(input);

        case 'brotli':
          // Brotli 可能不可用
          if (zlib.createBrotliCompress) {
            return zlib.brotliCompressSync(input);
          }
          // 回退到 gzip
          return zlib.gzipSync(input);

        case 'deflate':
          return zlib.deflateSync(input);

        case 'none':
        default:
          return input;
      }
    } catch (error) {
      console.error(`[Compression] Compress error: ${error.message}`);
      return data;
    }
  }

  /**
   * 解压数据
   */
  decompress(data, algorithm = null) {
    if (!this.enabled) {
      return data;
    }

    algorithm = algorithm || this.defaultAlgorithm;

    try {
      switch (algorithm) {
        case 'gzip':
          return zlib.gunzipSync(data);

        case 'brotli':
          if (zlib.createBrotliDecompress) {
            return zlib.brotliDecompressSync(data);
          }
          return zlib.gunzipSync(data);

        case 'deflate':
          return zlib.inflateSync(data);

        case 'none':
        default:
          return data;
      }
    } catch (error) {
      console.error(`[Compression] Decompress error: ${error.message}`);
      return data;
    }
  }

  /**
   * 压缩流
   */
  createCompressStream(algorithm = null) {
    algorithm = algorithm || this.defaultAlgorithm;

    switch (algorithm) {
      case 'gzip':
        return zlib.createGzip();
      case 'brotli':
        return zlib.createBrotliCompress?.() || zlib.createGzip();
      case 'deflate':
        return zlib.createDeflate();
      default:
        return zlib.createGzip();
    }
  }

  /**
   * 解压流
   */
  createDecompressStream(algorithm = null) {
    algorithm = algorithm || this.defaultAlgorithm;

    switch (algorithm) {
      case 'gzip':
        return zlib.createGunzip();
      case 'brotli':
        return zlib.createBrotliDecompress?.() || zlib.createGunzip();
      case 'deflate':
        return zlib.createInflate();
      default:
        return zlib.createGunzip();
    }
  }

  /**
   * 检测压缩头
   */
  detectCompression(buffer) {
    // 检查 gzip 头
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
      return 'gzip';
    }

    // 检查 brotli 头
    if (buffer[0] === 0xce && buffer[1] === 0xb2 && buffer[2] === 0x2f && buffer[3] === 0x00) {
      return 'brotli';
    }

    return 'none';
  }

  /**
   * 设置压缩算法
   */
  setAlgorithm(algorithm) {
    if (['gzip', 'brotli', 'deflate', 'none'].includes(algorithm)) {
      this.defaultAlgorithm = algorithm;
      console.log(`[Compression] Algorithm set to: ${algorithm}`);
    }
  }

  /**
   * 启用/禁用
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`[Compression] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * 获取状态
   */
  getStatus() {
    return {
      enabled: this.enabled,
      algorithm: this.defaultAlgorithm,
      available: ['gzip', 'brotli', 'deflate', 'none']
    };
  }
}

module.exports = CompressionManager;