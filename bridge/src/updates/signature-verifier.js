import logger from '../core/monitoring/logger.js';
/**
 * 代码签名验证模块
 *
 * 功能：
 * - 生成代码签名
 * - 验证签名有效性
 * - 防止篡改
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class SignatureVerifier {
  constructor(options = {}) {
    this.algorithm = options.algorithm || 'RSA-SHA256';
    this.keySize = options.keySize || 2048;
    this.keyPair = null;
    this.publicKeyPath = options.publicKeyPath || './data/keys/public.pem';
    this.privateKeyPath = options.privateKeyPath || './data/keys/private.pem';
  }

  /**
   * 生成密钥对
   */
  async generateKeyPair() {
    return new Promise((resolve, reject) => {
      crypto.generateKeyPair(
        'rsa',
        {
          modulusLength: this.keySize,
          publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
          },
          privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
          }
        },
        (err, publicKey, privateKey) => {
          if (err) {
            reject(err);
            return;
          }
          this.keyPair = { publicKey, privateKey };
          resolve(this.keyPair);
        }
      );
    });
  }

  /**
   * 保存密钥对
   */
  async saveKeyPair() {
    if (!this.keyPair) {
      throw new Error('No key pair to save');
    }

    const publicDir = path.dirname(this.publicKeyPath);
    const privateDir = path.dirname(this.privateKeyPath);

    [publicDir, privateDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    fs.writeFileSync(this.publicKeyPath, this.keyPair.publicKey);
    fs.writeFileSync(this.privateKeyPath, this.keyPair.privateKey);

    logger.info(`[Signature] Keys saved to ${publicDir}`);
  }

  /**
   * 加载密钥对
   */
  loadKeyPair() {
    if (fs.existsSync(this.publicKeyPath) && fs.existsSync(this.privateKeyPath)) {
      this.keyPair = {
        publicKey: fs.readFileSync(this.publicKeyPath, 'utf8'),
        privateKey: fs.readFileSync(this.privateKeyPath, 'utf8')
      };
      return true;
    }
    return false;
  }

  /**
   * 计算文件/内容的哈希
   */
  calculateHash(content) {
    if (typeof content === 'string') {
      return crypto.createHash('sha256').update(content).digest('hex');
    }
    // 文件
    if (Buffer.isBuffer(content)) {
      return crypto.createHash('sha256').update(content).digest('hex');
    }
    throw new Error('Unsupported content type');
  }

  /**
   * 计算目录的哈希
   */
  calculateDirectoryHash(dirPath) {
    const hash = crypto.createHash('sha256');
    const files = this.getAllFiles(dirPath).sort();

    for (const file of files) {
      const relativePath = path.relative(dirPath, file);
      const content = fs.readFileSync(file);
      hash.update(relativePath + ':' + content.toString('hex'));
    }

    return hash.digest('hex');
  }

  /**
   * 获取目录所有文件
   */
  getAllFiles(dirPath, arrayOfFiles = []) {
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      if (fs.statSync(filePath).isDirectory()) {
        this.getAllFiles(filePath, arrayOfFiles);
      } else {
        arrayOfFiles.push(filePath);
      }
    });

    return arrayOfFiles;
  }

  /**
   * 对内容签名
   */
  sign(content) {
    if (!this.keyPair || !this.keyPair.privateKey) {
      throw new Error('No private key available');
    }

    const hash = this.calculateHash(content);
    const sign = crypto.createSign(this.algorithm);
    sign.update(hash);
    sign.end();

    const signature = sign.sign(this.keyPair.privateKey, 'hex');
    return {
      algorithm: this.algorithm,
      hash,
      signature,
      signedAt: new Date().toISOString()
    };
  }

  /**
   * 验证签名
   */
  verify(content, signatureData) {
    if (!this.keyPair || !this.keyPair.publicKey) {
      throw new Error('No public key available');
    }

    const { signature, hash: originalHash } = signatureData;

    // 验证哈希
    const currentHash = this.calculateHash(content);
    if (currentHash !== originalHash) {
      return {
        valid: false,
        reason: 'Content hash mismatch - file may have been tampered'
      };
    }

    // 验证签名
    const verify = crypto.createVerify(this.algorithm);
    verify.update(originalHash);
    verify.end();

    const isValid = verify.verify(this.keyPair.publicKey, signature, 'hex');

    return {
      valid: isValid,
      reason: isValid ? 'Signature valid' : 'Signature verification failed'
    };
  }

  /**
   * 验证文件签名
   */
  verifyFile(filePath, signatureData) {
    const content = fs.readFileSync(filePath);
    return this.verify(content, signatureData);
  }

  /**
   * 验证目录签名
   */
  verifyDirectory(dirPath, signatureData) {
    const hash = this.calculateDirectoryHash(dirPath);
    return this.verify(hash, signatureData);
  }

  /**
   * 为发布包生成签名
   */
  signPackage(packagePath, metadata = {}) {
    const stats = fs.statSync(packagePath);
    const isDirectory = stats.isDirectory();

    let content;
    if (isDirectory) {
      content = this.calculateDirectoryHash(packagePath);
    } else {
      content = fs.readFileSync(packagePath);
    }

    const signature = this.sign(content);

    const packageInfo = {
      path: packagePath,
      isDirectory,
      hash: signature.hash,
      signature: signature.signature,
      algorithm: signature.algorithm,
      signedAt: signature.signedAt,
      metadata
    };

    return packageInfo;
  }

  /**
   * 验证发布包
   */
  verifyPackage(packageInfo) {
    const { path: packagePath, signature, isDirectory } = packageInfo;

    let content;
    if (isDirectory) {
      content = this.calculateDirectoryHash(packagePath);
    } else {
      content = fs.readFileSync(packagePath);
    }

    const result = this.verify(content, {
      signature,
      hash: packageInfo.hash
    });

    return {
      ...result,
      packagePath,
      signedAt: packageInfo.signedAt,
      metadata: packageInfo.metadata
    };
  }

  /**
   * 创建发布清单
   */
  createManifest(baseDir, version, files = null) {
    const targetFiles = files || this.getAllFiles(baseDir);
    const manifest = {
      version,
      createdAt: new Date().toISOString(),
      files: []
    };

    for (const file of targetFiles) {
      const relativePath = path.relative(baseDir, file);
      const content = fs.readFileSync(file);
      const hash = this.calculateHash(content);

      manifest.files.push({
        path: relativePath,
        hash,
        size: content.length
      });
    }

    // 对清单本身签名
    const manifestJson = JSON.stringify(manifest);
    const signature = this.sign(manifestJson);

    manifest.signature = signature.signature;
    manifest.algorithm = signature.algorithm;

    return manifest;
  }

  /**
   * 验证发布清单
   */
  verifyManifest(manifest) {
    const { files, signature, version, createdAt, ...rest } = manifest;

    // 重建清单进行比对
    const manifestData = { files, version, createdAt, ...rest };
    const manifestJson = JSON.stringify(manifestData);

    const result = this.verify(manifestJson, {
      signature,
      hash: rest.hash  // 需要保存原始哈希
    });

    return {
      ...result,
      version,
      fileCount: files?.length || 0
    };
  }
}

module.exports = { SignatureVerifier };