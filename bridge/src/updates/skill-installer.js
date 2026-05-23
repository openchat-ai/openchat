/**
 * Skill 下载和集成系统
 *
 * 功能：
 * - Skill 下载
 * - 本地集成
 * - 依赖解析
 * - 冲突检测
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SkillInstaller {
  constructor(options = {}) {
    this.skillsDir = options.skillsDir || './data/skills';
    this.tempDir = options.tempDir || './data/temp/skills';
    this.backupDir = options.backupDir || './data/skills/backups';
    this.installedSkills = new Map();
    this.dependencyGraph = new Map();
    this.ensureDirectories();
  }

  /**
   * 确保目录存在
   */
  ensureDirectories() {
    [this.skillsDir, this.tempDir, this.backupDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * 下载 Skill（从 URL 或本地）
   */
  async downloadSkill(skillSource) {
    const { url, name, version, source = 'local' } = skillSource;

    const skillPath = path.join(this.tempDir, `${name}-${version}`);

    try {
      if (source === 'local') {
        // 本地文件
        if (fs.existsSync(url)) {
          this.extractSkill(url, skillPath);
        } else {
          throw new Error(`Local file not found: ${url}`);
        }
      } else if (source === 'p2p') {
        // P2P 下载（简化版）
        // 实际实现中会从 P2P 网络获取
        throw new Error('P2P download not implemented yet');
      } else if (source === 'http') {
        // HTTP 下载
        const https = require('https');
        const http = require('http');

        await this.downloadFile(url, skillPath + '.zip');
        this.extractSkill(skillPath + '.zip', skillPath);
      }

      return { success: true, path: skillPath };
    } catch (error) {
      console.error(`[SkillInstaller] Download failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 下载文件
   */
  downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      protocol.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          this.downloadFile(response.headers.location, destPath)
            .then(resolve)
            .catch(reject);
          return;
        }

        const file = fs.createWriteStream(destPath);
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    });
  }

  /**
   * 提取 Skill 包
   */
  extractSkill(archivePath, destPath) {
    // 简化版：直接复制目录
    // 实际实现中会处理 zip/tar.gz 解压
    if (fs.statSync(archivePath).isDirectory()) {
      this.copyDirectory(archivePath, destPath);
    } else {
      // 尝试解压（需要 zip 包）
      // execSync(`unzip -o ${archivePath} -d ${destPath}`);
      throw new Error('Archive extraction not implemented');
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
   * 解析 Skill 依赖
   */
  resolveDependencies(skillManifest) {
    const { dependencies = {} } = skillManifest;
    const resolved = [];
    const unresolved = [];

    for (const [depName, versionSpec] of Object.entries(dependencies)) {
      const installed = this.installedSkills.get(depName);

      if (installed) {
        // 检查版本兼容性
        const isCompatible = this.checkVersionCompatibility(installed.version, versionSpec);
        if (isCompatible) {
          resolved.push({
            name: depName,
            version: installed.version,
            path: installed.path,
            satisfied: true
          });
        } else {
          unresolved.push({
            name: depName,
            required: versionSpec,
            installed: installed.version,
            reason: 'Version mismatch'
          });
        }
      } else {
        unresolved.push({
          name: depName,
          required: versionSpec,
          reason: 'Not installed'
        });
      }
    }

    return { resolved, unresolved };
  }

  /**
   * 检查版本兼容性
   */
  checkVersionCompatibility(installedVer, requiredVer) {
    // 简化版：支持 semver 格式
    // 实际使用 semver 库
    const cleanRequired = requiredVer.replace(/[\^~>=<]+/, '');
    const cleanInstalled = installedVer.replace(/[\^~>=<]+/, '');

    return cleanInstalled === cleanRequired ||
           requiredVer.includes(cleanInstalled) ||
           cleanInstalled.startsWith(cleanRequired.split('.')[0]);
  }

  /**
   * 检测冲突
   */
  detectConflicts(newSkill) {
    const conflicts = [];

    for (const [name, existing] of this.installedSkills) {
      if (name === newSkill.name) {
        // 同名 Skill，检查版本
        if (existing.version === newSkill.version) {
          conflicts.push({
            type: 'SAME_VERSION',
            skill: name,
            message: `Skill ${name} v${newSkill.version} already installed`
          });
        } else {
          conflicts.push({
            type: 'VERSION_CONFLICT',
            skill: name,
            existingVersion: existing.version,
            newVersion: newSkill.version,
            message: `Version conflict: ${existing.version} vs ${newSkill.version}`
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * 安装 Skill
   */
  async installSkill(skillPackage, options = {}) {
    const { name, version, dependencies = {}, skipDeps = false } = skillPackage;

    // 检查冲突
    const conflicts = this.detectConflicts({ name, version });
    if (conflicts.length > 0 && !options.force) {
      return { success: false, conflicts, reason: 'Conflicts detected' };
    }

    // 解析依赖
    if (!skipDeps) {
      const { resolved, unresolved } = this.resolveDependencies({ dependencies });

      if (unresolved.length > 0) {
        return {
          success: false,
          unresolved,
          reason: 'Dependencies not satisfied'
        };
      }

      skillPackage.resolvedDependencies = resolved;
    }

    // 备份现有版本（如果存在）
    const existing = this.installedSkills.get(name);
    if (existing && options.backup !== false) {
      await this.backupSkill(name);
    }

    // 复制到安装目录
    const installPath = path.join(this.skillsDir, name, version);
    if (fs.existsSync(skillPackage.path)) {
      this.copyDirectory(skillPackage.path, installPath);
    }

    // 保存安装信息
    const skillInfo = {
      name,
      version,
      path: installPath,
      installedAt: new Date().toISOString(),
      dependencies: skillPackage.resolvedDependencies || [],
      metadata: skillPackage.metadata || {}
    };

    this.installedSkills.set(name, {
      ...skillInfo,
      currentVersion: version
    });

    // 更新依赖图
    this.updateDependencyGraph(name, version, dependencies);

    // 保存清单
    this.saveSkillManifest(name, skillInfo);

    return {
      success: true,
      skill: skillInfo,
      conflictsResolved: conflicts.length
    };
  }

  /**
   * 备份 Skill
   */
  async backupSkill(name) {
    const skill = this.installedSkills.get(name);
    if (!skill) return false;

    const backupPath = path.join(this.backupDir, `${name}-${skill.version}-${Date.now()}`);

    try {
      this.copyDirectory(skill.path, backupPath);
      console.log(`[SkillInstaller] Backed up ${name} to ${backupPath}`);
      return true;
    } catch (error) {
      console.error(`[SkillInstaller] Backup failed:`, error.message);
      return false;
    }
  }

  /**
   * 更新依赖图
   */
  updateDependencyGraph(name, version, dependencies) {
    this.dependencyGraph.set(`${name}@${version}`, new Set(Object.keys(dependencies)));
  }

  /**
   * 保存 Skill 清单
   */
  saveSkillManifest(name, info) {
    const manifestPath = path.join(this.skillsDir, name, 'manifest.json');
    const manifest = {
      current: info.currentVersion,
      versions: {}
    };

    // 加载现有清单
    if (fs.existsSync(manifestPath)) {
      Object.assign(manifest, JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    }

    manifest.versions[info.version] = {
      installedAt: info.installedAt,
      dependencies: info.dependencies,
      metadata: info.metadata
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  }

  /**
   * 卸载 Skill
   */
  async uninstallSkill(name, options = {}) {
    const skill = this.installedSkills.get(name);
    if (!skill) {
      return { success: false, reason: 'Skill not installed' };
    }

    // 检查依赖
    const dependents = this.findDependents(name);
    if (dependents.length > 0 && !options.force) {
      return {
        success: false,
        reason: 'Other skills depend on this',
        dependents
      };
    }

    // 备份
    if (options.backup !== false) {
      await this.backupSkill(name);
    }

    // 删除
    const installPath = path.join(this.skillsDir, name);
    if (fs.existsSync(installPath)) {
      fs.rmSync(installPath, { recursive: true, force: true });
    }

    this.installedSkills.delete(name);

    return { success: true, name };
  }

  /**
   * 查找依赖此 Skill 的其他 Skill
   */
  findDependents(skillName) {
    const dependents = [];

    for (const [key, deps] of this.dependencyGraph) {
      if (deps.has(skillName)) {
        const [name] = key.split('@');
        dependents.push(name);
      }
    }

    return dependents;
  }

  /**
   * 获取已安装的 Skill 列表
   */
  getInstalledSkills() {
    return Array.from(this.installedSkills.values());
  }

  /**
   * 获取 Skill 信息
   */
  getSkillInfo(name) {
    return this.installedSkills.get(name);
  }

  /**
   * 加载已安装的 Skills
   */
  loadInstalledSkills() {
    if (!fs.existsSync(this.skillsDir)) return;

    const dirs = fs.readdirSync(this.skillsDir);
    for (const dir of dirs) {
      const manifestPath = path.join(this.skillsDir, dir, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (manifest.current) {
          const version = manifest.current;
          this.installedSkills.set(dir, {
            name: dir,
            version,
            path: path.join(this.skillsDir, dir, version),
            currentVersion: version,
            installedAt: manifest.versions[version]?.installedAt
          });
        }
      }
    }
  }
}

module.exports = { SkillInstaller };