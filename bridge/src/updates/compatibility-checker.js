/**
 * 兼容性检查引擎
 *
 * 功能：
 * - 版本兼容性检查
 * - API 兼容性分析
 * - 依赖检查
 */

const semver = require('semver');

class CompatibilityChecker {
  constructor(options = {}) {
    this.currentVersion = options.currentVersion || '1.0.0';
    this.breakingChanges = new Map();  // 记录的破坏性变更
  }

  /**
   * 检查两个版本是否兼容
   */
  checkVersionCompatibility(currentVer, newVer) {
    const current = semver.parse(currentVer);
    const target = semver.parse(newVer);

    if (!current || !target) {
      return {
        compatible: false,
        reason: 'Invalid version format'
      };
    }

    // 相同版本
    if (current.version === target.version) {
      return { compatible: true, type: 'SAME' };
    }

    // 主版本号变化 - 不兼容
    if (target.major !== current.major) {
      return {
        compatible: false,
        type: 'MAJOR',
        reason: `Major version changed from ${current.major} to ${target.major}`,
        breakingChanges: true
      };
    }

    // 次版本号变化 - 向后兼容
    if (target.minor !== current.minor) {
      return {
        compatible: true,
        type: 'MINOR',
        reason: `Minor version changed from ${current.minor} to ${target.minor}, new features added`,
        breakingChanges: false
      };
    }

    // 补丁版本变化 - 完全兼容
    return {
      compatible: true,
      type: 'PATCH',
      reason: `Patch version changed from ${current.patch} to ${target.patch}, bug fixes`,
      breakingChanges: false
    };
  }

  /**
   * 检查 API 兼容性
   */
  checkApiCompatibility(oldApis, newApis) {
    const breaking = [];
    const deprecated = [];
    const added = [];

    const oldSet = new Set(Object.keys(oldApis));
    const newSet = new Set(Object.keys(newApis));

    // 检查移除的 API
    for (const api of oldSet) {
      if (!newSet.has(api)) {
        breaking.push({
          api,
          change: 'REMOVED',
          severity: 'HIGH'
        });
      }
    }

    // 检查新增的 API
    for (const api of newSet) {
      if (!oldSet.has(api)) {
        added.push({
          api,
          change: 'ADDED',
          severity: 'LOW'
        });
      }
    }

    // 检查参数变化
    for (const api of oldSet) {
      if (newSet.has(api)) {
        const oldParams = oldApis[api]?.params || [];
        const newParams = newApis[api]?.params || [];

        // 检查必需参数是否被移除
        for (const param of oldParams) {
          if (param.required && !newParams.find(p => p.name === param.name)) {
            breaking.push({
              api,
              change: 'PARAM_REMOVED',
              param: param.name,
              severity: 'HIGH'
            });
          }
        }

        // 检查新增可选参数
        for (const param of newParams) {
          if (!oldParams.find(p => p.name === param.name) && !param.required) {
            added.push({
              api,
              change: 'PARAM_ADDED',
              param: param.name,
              optional: true,
              severity: 'LOW'
            });
          }
        }
      }
    }

    // 检查返回值变化
    for (const api of oldSet) {
      if (newSet.has(api)) {
        const oldReturn = oldApis[api]?.returns;
        const newReturn = newApis[api]?.returns;

        if (oldReturn && newReturn && oldReturn.type !== newReturn.type) {
          breaking.push({
            api,
            change: 'RETURN_TYPE_CHANGED',
            from: oldReturn.type,
            to: newReturn.type,
            severity: 'MEDIUM'
          });
        }
      }
    }

    const isCompatible = breaking.length === 0;

    return {
      compatible: isCompatible,
      breaking,
      deprecated,
      added,
      summary: isCompatible
        ? 'API 完全兼容'
        : `发现 ${breaking.length} 个破坏性变更`
    };
  }

  /**
   * 检查依赖兼容性
   */
  checkDependencies(currentDeps, newDeps) {
    const issues = [];
    const warnings = [];
    const passed = [];

    // 检查新依赖
    for (const [name, version] of Object.entries(newDeps)) {
      if (!currentDeps[name]) {
        // 新增依赖
        const issue = {
          dependency: name,
          currentVersion: null,
          newVersion: version,
          change: 'ADDED',
          severity: 'INFO'
        };

        // 检查是否是可选依赖
        if (version.startsWith('optional:')) {
          issue.severity = 'LOW';
          warnings.push(issue);
        } else {
          issues.push(issue);
        }
      } else {
        // 版本变化
        const currentVer = currentDeps[name];
        const compatibility = this.checkVersionCompatibility(currentVer, version.replace('^', '').replace('~', ''));

        if (!compatibility.compatible) {
          issues.push({
            dependency: name,
            currentVersion: currentVer,
            newVersion: version,
            change: 'VERSION_BREAKING',
            severity: 'HIGH',
            reason: compatibility.reason
          });
        } else if (compatibility.type === 'MAJOR') {
          warnings.push({
            dependency: name,
            currentVersion: currentVer,
            newVersion: version,
            change: 'MAJOR_VERSION',
            severity: 'MEDIUM',
            reason: compatibility.reason
          });
        } else {
          passed.push({
            dependency: name,
            currentVersion: currentVer,
            newVersion: version,
            change: compatibility.type,
            severity: 'LOW'
          });
        }
      }
    }

    // 检查移除的依赖
    for (const name of Object.keys(currentDeps)) {
      if (!newDeps[name]) {
        warnings.push({
          dependency: name,
          currentVersion: currentDeps[name],
          newVersion: null,
          change: 'REMOVED',
          severity: 'MEDIUM',
          reason: '依赖被移除，可能影响功能'
        });
      }
    }

    const isCompatible = issues.filter(i => i.severity === 'HIGH').length === 0;

    return {
      compatible: isCompatible,
      issues,
      warnings,
      passed,
      summary: isCompatible
        ? '依赖兼容'
        : `发现 ${issues.length} 个问题`
    };
  }

  /**
   * 综合兼容性评估
   */
  async evaluateUpdate(newVersion, updateInfo = {}) {
    const { apis, dependencies, features, breakingChanges } = updateInfo;

    const versionCheck = this.checkVersionCompatibility(this.currentVersion, newVersion);
    const results = {
      newVersion,
      currentVersion: this.currentVersion,
      overallCompatible: versionCheck.compatible,
      checks: {}
    };

    // 版本检查
    results.checks.version = versionCheck;

    // API 兼容性检查
    if (apis && Object.keys(apis).length > 0) {
      results.checks.api = this.checkApiCompatibility({}, apis);
      if (!results.checks.api.compatible) {
        results.overallCompatible = false;
      }
    }

    // 依赖检查
    if (dependencies && Object.keys(dependencies).length > 0) {
      results.checks.dependencies = this.checkDependencies({}, dependencies);
      if (!results.checks.dependencies.compatible) {
        results.overallCompatible = false;
      }
    }

    // 功能变更检查
    if (features && features.length > 0) {
      results.checks.features = {
        added: features.filter(f => f.type === 'added'),
        removed: features.filter(f => f.type === 'removed'),
        modified: features.filter(f => f.type === 'modified')
      };
    }

    // 破坏性变更记录
    if (breakingChanges && breakingChanges.length > 0) {
      results.breakingChanges = breakingChanges;
      results.overallCompatible = false;
    }

    // 风险评估
    results.riskAssessment = this.assessRisk(results);

    return results;
  }

  /**
   * 评估更新风险
   */
  assessRisk(evaluation) {
    let riskScore = 0;
    const factors = [];

    // 版本变化风险
    if (evaluation.checks.version?.type === 'MAJOR') {
      riskScore += 40;
      factors.push('主版本变化，高风险');
    } else if (evaluation.checks.version?.type === 'MINOR') {
      riskScore += 15;
      factors.push('次版本变化，中等风险');
    }

    // API 变化风险
    if (evaluation.checks.api?.breaking) {
      riskScore += evaluation.checks.api.breaking.length * 15;
      factors.push(`${evaluation.checks.api.breaking.length} 个 API 破坏性变更`);
    }

    // 依赖变化风险
    if (evaluation.checks.dependencies?.issues) {
      riskScore += evaluation.checks.dependencies.issues.length * 10;
      factors.push(`${evaluation.checks.dependencies.issues.length} 个依赖问题`);
    }

    // 风险等级
    let level = 'LOW';
    if (riskScore >= 50) level = 'HIGH';
    else if (riskScore >= 25) level = 'MEDIUM';

    return {
      score: riskScore,
      level,
      factors
    };
  }

  /**
   * 设置当前版本
   */
  setCurrentVersion(version) {
    this.currentVersion = version;
  }

  /**
   * 获取兼容的版本范围
   */
  getCompatibleRange(version, type = 'patch') {
    const v = semver.parse(version);
    if (!v) return null;

    switch (type) {
      case 'patch':
        return `^${v.major}.${v.minor}.${v.patch}`;
      case 'minor':
        return `^${v.major}.${v.minor}`;
      case 'major':
        return `^${v.major}`;
      default:
        return version;
    }
  }
}

module.exports = { CompatibilityChecker };