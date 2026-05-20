/**
 * CodeAnalyzer — 居民代码异常检测引擎
 *
 * 纯函数、同步、零外部依赖。
 * 供 self_check 体检调用，扫描源码发现重复/异常模式并生成修复。
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/** 目标：_evolve() 重复调用的 if-block 特征 */
const DUPLICATE_EVOLVE_CONDITION =
  `if ((act.action === 'innovate' || act.action === 'quick_fix' || act.action === 'diagnose' || act.action === 'repair') && this.safeEvolution)`;

class CodeAnalyzer {
  /**
   * @param {string} projectRoot  项目根目录（bridge/）
   */
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this._orchestratorPath = null;
  }

  /**
   * 获取 house-orchestrator.js 的完整路径
   */
  _getOrchestratorPath() {
    if (!this._orchestratorPath) {
      this._orchestratorPath = path.join(this.projectRoot, 'src', 'core', 'house-orchestrator.js');
    }
    return this._orchestratorPath;
  }

  /**
   * 检测 executeActions() 中重复的 _evolve() 调用
   *
   * 当前 BUG：两个完全相同的 if-block 调用 _evolve()
   * 第二次调用是多余的，应被移除。
   *
   * @returns {{ detected: boolean, firstBlockLines?: [number, number], secondBlockLines?: [number, number], file?: string }}
   */
  detectDuplicateEvolveCalls() {
    const filePath = this._getOrchestratorPath();
    if (!fs.existsSync(filePath)) {
      return { detected: false };
    }

    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    const matchLines = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      // 匹配 if-block 的头部
      if (trimmed.startsWith('if ((act.action ===') && trimmed.includes("this.safeEvolution")) {
        let braceCount = 0;
        let startLine = i;
        // 从当前行找到 if 块的结束位置
        for (let j = i; j < lines.length; j++) {
          for (const ch of lines[j]) {
            if (ch === '{') braceCount++;
            if (ch === '}') braceCount--;
          }
          if (braceCount === 0 && j > i) {
            matchLines.push([startLine, j]);
            i = j; // 跳过已匹配的行
            break;
          }
        }
      }
    }

    if (matchLines.length >= 2) {
      return {
        detected: true,
        firstBlockLines: matchLines[0],
        secondBlockLines: matchLines[1],
        file: 'src/core/house-orchestrator.js',
      };
    }

    return { detected: false };
  }

  /**
   * 生成修复内容：移除第二次重复的 _evolve() if-block
   *
   * @param {string} originalContent  原始文件内容
   * @returns {{ newContent: string, oldHash: string, diffLines: number } | null}
   */
  generateEvolveFix(originalContent) {
    const oldHash = createHash('sha256').update(originalContent).digest('hex');

    const lines = originalContent.split('\n');
    const detection = this._findSecondBlockLines(lines);
    if (!detection) return null;

    const { startLine, endLine } = detection;

    // 生成新内容：移除 startLine..endLine（含）
    const newLines = [...lines.slice(0, startLine), ...lines.slice(endLine + 1)];
    const newContent = newLines.join('\n');

    const diffLines = (endLine - startLine + 1);
    return { newContent, oldHash, diffLines };
  }

  /**
   * 在行数组中定位第二个重复 if-block 的行范围
   */
  _findSecondBlockLines(lines) {
    const matchBlocks = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('if ((act.action ===') && trimmed.includes("this.safeEvolution")) {
        let startLine = i;
        let braceCount = 0;
        let foundOpen = false;
        for (let j = i; j < lines.length; j++) {
          for (const ch of lines[j]) {
            if (ch === '{') { braceCount++; foundOpen = true; }
            if (ch === '}') braceCount--;
          }
          if (foundOpen && braceCount === 0) {
            matchBlocks.push({ startLine, endLine: j });
            i = j;
            break;
          }
        }
      }
    }

    // 返回第二个块（索引 1），如果存在
    return matchBlocks.length >= 2 ? matchBlocks[1] : null;
  }
}

export { CodeAnalyzer };
