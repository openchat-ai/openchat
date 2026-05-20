import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * SkillManager 类：管理 Skill 的持久化存储和加载
 *
 * 功能：
 * - 将 Skill 持久化到磁盘 (~/.openchat/skills.json)
 * - 支持 Skill 的增删改查
 * - 支持导入导出功能
 */
class SkillManager {
  constructor(storageDir = null) {
    // 默认存储位置：~/.openchat/skills.json
    this.storageDir = storageDir || path.join(os.homedir(), '.openchat');
    this.skillsFile = path.join(this.storageDir, 'skills.json');
    this.skills = new Map();

    // 确保存储目录存在
    this.ensureStorageDir();
  }

  /**
   * 确保存储目录存在
   */
  ensureStorageDir() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * 添加或更新一个 Skill
   * @param {string} id - Skill 的唯一标识符
   * @param {object} skill - Skill 对象，包含 name, description, code 等
   */
  addSkill(id, skill) {
    if (!id || !skill) {
      throw new Error('Skill ID 和 Skill 对象不能为空');
    }

    // 确保 skill 对象有必要的字段
    const skillData = {
      id,
      name: skill.name || '',
      description: skill.description || '',
      code: skill.code || '',
      version: skill.version || '1.0.0',
      createdAt: skill.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...skill,
    };

    this.skills.set(id, skillData);
  }

  /**
   * 获取一个 Skill
   * @param {string} id - Skill 的唯一标识符
   * @returns {object|null} Skill 对象或 null
   */
  getSkill(id) {
    return this.skills.get(id) || null;
  }

  /**
   * 获取所有 Skills
   * @returns {Array} Skills 数组
   */
  getAllSkills() {
    return Array.from(this.skills.values());
  }

  /**
   * 删除一个 Skill
   * @param {string} id - Skill 的唯一标识符
   * @returns {boolean} 是否删除成功
   */
  removeSkill(id) {
    return this.skills.delete(id);
  }

  /**
   * 将 Skills 保存到磁盘
   * @returns {Promise<void>}
   */
  async saveSkills() {
    try {
      const skillsArray = Array.from(this.skills.values());
      const data = {
        version: '1.0',
        savedAt: new Date().toISOString(),
        count: skillsArray.length,
        skills: skillsArray,
      };

      // 写入文件
      await fs.promises.writeFile(
        this.skillsFile,
        JSON.stringify(data, null, 2),
        'utf-8'
      );

      return {
        success: true,
        message: `Successfully saved ${skillsArray.length} skills to ${this.skillsFile}`,
        count: skillsArray.length,
      };
    } catch (error) {
      throw new Error(`Failed to save skills: ${error.message}`);
    }
  }

  /**
   * 从磁盘加载 Skills
   * @returns {Promise<Array>} 加载的 Skills 数组
   */
  async loadSkills() {
    // 如果文件不存在，返回空数组
    if (!fs.existsSync(this.skillsFile)) {
      return [];
    }

    // 重试 3 次，防止并发写入时的竞态
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const fileContent = await fs.promises.readFile(this.skillsFile, 'utf-8');
        const data = JSON.parse(fileContent);

        // 验证数据格式
        if (!data.skills || !Array.isArray(data.skills)) {
          throw new Error('Invalid skills file format');
        }

        // 加载 Skills 到内存
        this.skills.clear();
        data.skills.forEach(skill => {
          if (skill.id) {
            this.skills.set(skill.id, skill);
          }
        });

        return data.skills;
      } catch (error) {
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }
        throw new Error(`Failed to load skills: ${error.message}`);
      }
    }
  }

  /**
   * 清空所有 Skills
   */
  clearSkills() {
    this.skills.clear();
  }

  /**
   * 获取存储文件路径
   * @returns {string} 存储文件的完整路径
   */
  getStoragePath() {
    return this.skillsFile;
  }

  /**
   * 导出 Skills 为 JSON 字符串
   * @returns {string} JSON 字符串
   */
  exportAsJSON() {
    const skillsArray = Array.from(this.skills.values());
    return JSON.stringify(skillsArray, null, 2);
  }

  /**
   * 从 JSON 字符串导入 Skills
   * @param {string} jsonString - JSON 字符串
   */
  importFromJSON(jsonString) {
    try {
      const skills = JSON.parse(jsonString);

      if (!Array.isArray(skills)) {
        throw new Error('Import data must be an array of skills');
      }

      this.skills.clear();
      skills.forEach(skill => {
        if (skill.id) {
          this.skills.set(skill.id, skill);
        }
      });

      return {
        success: true,
        count: skills.length,
      };
    } catch (error) {
      throw new Error(`Failed to import skills: ${error.message}`);
    }
  }
}

export default SkillManager;
