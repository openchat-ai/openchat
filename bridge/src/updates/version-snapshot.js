/**
 * 版本快照系统
 *
 * 功能：
 * - 版本快照创建
 * - 快照恢复
 * - 快照清理
 * - 快照持久化
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class VersionSnapshot {
  constructor(options = {}) {
    this.snapshotDir = options.snapshotDir || './data/versions/snapshots';
    this.maxSnapshots = options.maxSnapshots || 10;
    this.maxAge = options.maxAge || 30 * 24 * 60 * 60 * 1000; // 30天
    this.snapshots = new Map();
    this.currentVersion = null;
    this.ensureDirectories();
    this.loadSnapshots();
  }

  /**
   * 确保目录存在
   */
  ensureDirectories() {
    if (!fs.existsSync(this.snapshotDir)) {
      fs.mkdirSync(this.snapshotDir, { recursive: true });
    }
  }

  /**
   * 创建快照
   */
  async createSnapshot(version, metadata = {}) {
    const snapshotId = `${version}_${Date.now()}`;
    const snapshotPath = path.join(this.snapshotDir, snapshotId);

    try {
      fs.mkdirSync(snapshotPath, { recursive: true });

      // 快照元数据
      const snapshot = {
        id: snapshotId,
        version,
        createdAt: new Date().toISOString(),
        metadata,
        files: [],
        size: 0,
        checksum: null
      };

      // 复制关键文件（需要根据实际项目结构调整）
      const sourceDirs = ['src', 'config'];
      let totalSize = 0;

      for (const dir of sourceDirs) {
        if (fs.existsSync(dir)) {
          const destDir = path.join(snapshotPath, dir);
          this.copyDirectory(dir, destDir);

          // 计算大小
          totalSize += this.getDirectorySize(dir);
        }
      }

      snapshot.size = totalSize;

      // 计算校验和
      snapshot.checksum = await this.calculateChecksum(snapshotPath);

      // 保存元数据
      const metadataPath = path.join(snapshotPath, 'metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify(snapshot, null, 2));

      this.snapshots.set(snapshotId, snapshot);

      // 清理旧快照
      await this.cleanupOldSnapshots();

      console.log(`[VersionSnapshot] Created snapshot ${snapshotId}, size: ${totalSize} bytes`);

      return { success: true, snapshot };
    } catch (error) {
      console.error(`[VersionSnapshot] Failed to create snapshot:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 复制目录
   */
  copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * 获取目录大小
   */
  getDirectorySize(dirPath) {
    let size = 0;
    if (!fs.existsSync(dirPath)) return 0;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        size += this.getDirectorySize(filePath);
      } else {
        size += fs.statSync(filePath).size;
      }
    }

    return size;
  }

  /**
   * 计算校验和
   */
  async calculateChecksum(dirPath) {
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
   * 获取所有文件
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
   * 恢复快照
   */
  async restoreSnapshot(snapshotId, options = {}) {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      return { success: false, error: 'Snapshot not found' };
    }

    const snapshotPath = path.join(this.snapshotDir, snapshotId);

    try {
      // 验证校验和
      const currentChecksum = await this.calculateChecksum(snapshotPath);
      if (currentChecksum !== snapshot.checksum && !options.skipVerify) {
        return { success: false, error: 'Checksum mismatch - snapshot may be corrupted' };
      }

      // 备份当前版本
      if (options.backup !== false && this.currentVersion) {
        await this.createSnapshot(this.currentVersion, { reason: 'pre-restore-backup' });
      }

      // 恢复文件
      const sourceDirs = ['src', 'config'];
      for (const dir of sourceDirs) {
        const sourceDir = path.join(snapshotPath, dir);
        if (fs.existsSync(sourceDir)) {
          // 先删除目标
          const destDir = dir;
          if (fs.existsSync(destDir)) {
            fs.rmSync(destDir, { recursive: true, force: true });
          }
          this.copyDirectory(sourceDir, destDir);
        }
      }

      this.currentVersion = snapshot.version;

      console.log(`[VersionSnapshot] Restored snapshot ${snapshotId}, version: ${snapshot.version}`);

      return {
        success: true,
        version: snapshot.version,
        snapshotId
      };
    } catch (error) {
      console.error(`[VersionSnapshot] Failed to restore snapshot:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 删除快照
   */
  async deleteSnapshot(snapshotId) {
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot) {
      return { success: false, error: 'Snapshot not found' };
    }

    const snapshotPath = path.join(this.snapshotDir, snapshotId);

    try {
      fs.rmSync(snapshotPath, { recursive: true, force: true });
      this.snapshots.delete(snapshotId);

      console.log(`[VersionSnapshot] Deleted snapshot ${snapshotId}`);

      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * 清理旧快照
   */
  async cleanupOldSnapshots() {
    const now = Date.now();
    const toDelete = [];

    // 按时间清理
    for (const [id, snapshot] of this.snapshots) {
      const age = now - new Date(snapshot.createdAt).getTime();
      if (age > this.maxAge) {
        toDelete.push(id);
      }
    }

    // 超过最大数量时，删除最旧的
    if (this.snapshots.size > this.maxSnapshots) {
      const sorted = Array.from(this.snapshots.entries())
        .sort((a, b) => new Date(a[1].createdAt) - new Date(b[1].createdAt));

      const excess = this.snapshots.size - this.maxSnapshots;
      for (let i = 0; i < excess; i++) {
        if (!toDelete.includes(sorted[i][0])) {
          toDelete.push(sorted[i][0]);
        }
      }
    }

    for (const id of toDelete) {
      await this.deleteSnapshot(id);
    }

    return toDelete.length;
  }

  /**
   * 列出快照
   */
  listSnapshots(options = {}) {
    const { version, limit = 20 } = options;

    let snapshots = Array.from(this.snapshots.values());

    if (version) {
      snapshots = snapshots.filter(s => s.version === version);
    }

    // 按创建时间排序
    snapshots.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return snapshots.slice(0, limit);
  }

  /**
   * 获取快照信息
   */
  getSnapshotInfo(snapshotId) {
    return this.snapshots.get(snapshotId);
  }

  /**
   * 加载快照
   */
  loadSnapshots() {
    if (!fs.existsSync(this.snapshotDir)) return;

    const dirs = fs.readdirSync(this.snapshotDir);

    for (const dir of dirs) {
      const metadataPath = path.join(this.snapshotDir, dir, 'metadata.json');
      if (fs.existsSync(metadataPath)) {
        try {
          const snapshot = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
          this.snapshots.set(snapshot.id, snapshot);
        } catch (e) {
          console.error(`[VersionSnapshot] Failed to load snapshot ${dir}:`, e.message);
        }
      }
    }

    console.log(`[VersionSnapshot] Loaded ${this.snapshots.size} snapshots`);
  }

  /**
   * 获取快照统计
   */
  getStats() {
    const snapshots = Array.from(this.snapshots.values());
    const totalSize = snapshots.reduce((sum, s) => sum + (s.size || 0), 0);

    return {
      count: snapshots.length,
      totalSize,
      maxSnapshots: this.maxSnapshots,
      oldestSnapshot: snapshots.length > 0
        ? snapshots.reduce((oldest, s) =>
            new Date(s.createdAt) < new Date(oldest.createdAt) ? s : oldest
          ).createdAt
        : null,
      newestSnapshot: snapshots.length > 0
        ? snapshots.reduce((newest, s) =>
            new Date(s.createdAt) > new Date(newest.createdAt) ? s : newest
          ).createdAt
        : null
    };
  }

  /**
   * 设置当前版本
   */
  setCurrentVersion(version) {
    this.currentVersion = version;
  }
}

module.exports = { VersionSnapshot };