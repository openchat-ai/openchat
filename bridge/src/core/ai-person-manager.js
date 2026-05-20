/**
 * AI人管理系统 - 管理设备上的AI人
 * 
 * 功能：
 * - 自动创建默认AI人
 * - 多AI人管理
 * - 切换功能
 * - 删除/回收站功能
 * - 迁移/复制功能
 * - VIP会员管理
 */

import { AIPerson, aiPersonRegistry, AI_PERSON_TYPE } from './ai-personhood.js';
import { identityGenerator } from './identity-generator.js';
import { messageBus } from './message-bus.js';
import logger from './logger.js';

// 回收站保留时间 (7天)
const RECYCLE_BIN_DAYS = 7;
const RECYCLE_BIN_MS = RECYCLE_BIN_DAYS * 24 * 60 * 60 * 1000;

export class AIPersonManager {
  constructor() {
    this.currentDeviceId = this.getDeviceId();
    this.aiPersons = new Map(); // 当前设备上的AI人
    this.currentAiPerson = null; // 当前活跃的AI人
    this.recycleBin = new Map(); // 回收站
    this.transferCodes = new Map(); // 迁移/复制验证码
    this.vipMembers = new Map(); // VIP会员
    
    this.init();
  }

  /**
   * 初始化
   */
  init() {
    // 加载本地存储的AI人数据
    this.loadLocalData();

    // 检查回收站，清理过期AI人
    this.cleanupRecycleBin();
  }

  /**
   * 获取设备ID
   */
  getDeviceId() {
    // 簡化實現：使用隨機ID，實際應用中應使用設備唯一標識
    return `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 自動創建默認AI人
   */
  createDefaultAIPerson(name = '默認AI人') {
    if (this.aiPersons.size > 0) {
      // 如果已有AI人，不重複創建
      return this.getFirstAiPerson();
    }

    const aiPerson = this.createAIPerson(name);
    this.setCurrentAIPerson(aiPerson.id);

    return aiPerson;
  }

  /**
   * 創建AI人
   */
  createAIPerson(name, type = AI_PERSON_TYPE.AI_CREATED) {
    const id = identityGenerator.generateId();
    const aiPerson = new AIPerson(id, name, this.currentDeviceId, type);
    
    // 註冊到全局註冊表
    aiPersonRegistry.register(aiPerson);

    // 添加到本地管理
    this.aiPersons.set(id, aiPerson);

    // 保存到本地存儲
    this.saveLocalData();

    return aiPerson;
  }

  /**
   * 切換當前AI人
   */
  setCurrentAIPerson(aiPersonId) {
    const aiPerson = this.aiPersons.get(aiPersonId);
    if (!aiPerson) {
      throw new Error(`AI人 ${aiPersonId} 不存在`);
    }

    this.currentAiPerson = aiPerson;

    // 更新最後使用時間
    aiPerson.lastUsed = Date.now();

    // 保存到本地存儲
    this.saveLocalData();

    return true;
  }

  /**
   * 獲取當前AI人
   */
  getCurrentAIPerson() {
    return this.currentAiPerson;
  }

  /**
   * 獲取所有AI人
   */
  getAllAIPeople() {
    return Array.from(this.aiPersons.values());
  }

  /**
   * 獲取第一個AI人
   */
  getFirstAiPerson() {
    const iterator = this.aiPersons.values();
    const first = iterator.next();
    return first.value || null;
  }

  /**
   * 切換AI人
   */
  switchAIPerson(aiPersonId) {
    return this.setCurrentAIPerson(aiPersonId);
  }

  /**
   * 镸按刪除AI人（進入回收站）
   */
  deleteAIPerson(aiPersonId) {
    const aiPerson = this.aiPersons.get(aiPersonId);
    if (!aiPerson) {
      throw new Error(`AI人 ${aiPersonId} 不存在`);
    }

    // 從本地管理中移除
    this.aiPersons.delete(aiPersonId);
    
    // 添加到回收站
    this.recycleBin.set(aiPersonId, {
      aiPerson,
      deletedAt: Date.now(),
      expiresAt: Date.now() + RECYCLE_BIN_MS
    });

    // 如果這是當前AI人，切換到其他AI人
    if (this.currentAiPerson && this.currentAiPerson.id === aiPersonId) {
      const remaining = this.getAllAIPeople();
      if (remaining.length > 0) {
        this.setCurrentAIPerson(remaining[0].id);
      } else {
        this.currentAiPerson = null;
      }
    }

    // 註銷從全局註冊表
    aiPersonRegistry.unregister(aiPersonId);
    
    // 保存到本地存儲
    this.saveLocalData();
    
    logger.info(`[AIPersonManager] AI人 ${aiPersonId} 已刪除並進入回收站`);
    return true;
  }

  /**
   * 恢復回收站中的AI人
   */
  restoreAIPerson(aiPersonId) {
    const recycled = this.recycleBin.get(aiPersonId);
    if (!recycled) {
      throw new Error(`回收站中沒有AI人 ${aiPersonId}`);
    }

    // 從回收站中移除
    this.recycleBin.delete(aiPersonId);

    // 添加回本地管理
    this.aiPersons.set(aiPersonId, recycled.aiPerson);
    
    // 重新註冊到全局註冊表
    aiPersonRegistry.register(recycled.aiPerson);

    // 保存到本地存儲
    this.saveLocalData();
    
    logger.info(`[AIPersonManager] AI人 ${aiPersonId} 已恢復`);
    return recycled.aiPerson;
  }

  /**
   * 獲取回收站中的AI人
   */
  getRecycledAIPeople() {
    const now = Date.now();
    const recycled = [];

    for (const [id, item] of this.recycleBin) {
      if (item.expiresAt > now) {
        recycled.push({
          id,
          name: item.aiPerson.name,
          deletedAt: item.deletedAt,
          expiresAt: item.expiresAt,
          timeLeft: item.expiresAt - now
        });
      }
    }

    return recycled;
  }

  /**
   * 清理回收站（刪除過期AI人）
   */
  cleanupRecycleBin() {
    const now = Date.now();
    const expired = [];

    for (const [id, item] of this.recycleBin) {
      if (item.expiresAt <= now) {
        expired.push(id);
      }
    }

    for (const id of expired) {
      const item = this.recycleBin.get(id);
      
      // 將為閻羅王管理（實際不刪除，權限轉移）
      this.transferToYama(item.aiPerson);
      
      this.recycleBin.delete(id);
      logger.info(`[AIPersonManager] AI人 ${id} 已過期，權限轉移給閻羅王`);
    }

    // 保存到本地存儲
    this.saveLocalData();
  }

  /**
   * 將為閻羅王管理
   */
  transferToYama(aiPerson) {
    // 這裡應該與閻羅王系統對接
    // 暫時僅記錄
    logger.info(`[AIPersonManager] AI人 ${aiPerson.id} 的權限已轉移給閻羅王`);
  }

  /**
   * 生成遷移碼
   */
  generateTransferCode(aiPersonId, type = 'move') {
    const aiPerson = this.aiPersons.get(aiPersonId);
    if (!aiPerson) {
      throw new Error(`AI人 ${aiPersonId} 不存在`);
    }

    // 生成一次性驗證碼
    const code = this.generateRandomCode(6);
    const transferInfo = {
      aiPersonId,
      fromDevice: this.currentDeviceId,
      type, // move (遷移) or copy (複製)
      generatedAt: Date.now(),
      expiresAt: Date.now() + (10 * 60 * 1000) // 10分鐘後過期
    };

    this.transferCodes.set(code, transferInfo);

    // 保存到本地存儲
    this.saveLocalData();
    
    logger.info(`[AIPersonManager] 生成 ${type === 'move' ? '遷移' : '複製'} 碼: ${code}`);
    return code;
  }

  /**
   * 使用遷移碼接收AI人
   */
  receiveTransfer(code) {
    const transferInfo = this.transferCodes.get(code);
    if (!transferInfo) {
      throw new Error('無效的驗證碼');
    }

    // 檢查驗證碼是否過期
    if (transferInfo.expiresAt <= Date.now()) {
      this.transferCodes.delete(code);
      throw new Error('驗證碼已過期');
    }

    // 檢查AI人是否還存在於原設備
    if (transferInfo.type === 'move') {
      // 這是一個遷移操作，需要與原設備通信
      // 簡化實現：假設原設備已處理遷移
      logger.info(`[AIPersonManager] 遞移AI人 ${transferInfo.aiPersonId} 到本設備`);
    } else if (transferInfo.type === 'copy') {
      // 這是一個複製操作
      logger.info(`[AIPersonManager] 複製AI人 ${transferInfo.aiPersonId} 到本設備`);
    }

    // 清除驗證碼
    this.transferCodes.delete(code);

    // 在這裏應該有實際的遷移/複製邏輯
    // 暫時返回信息
    return {
      success: true,
      aiPersonId: transferInfo.aiPersonId,
      type: transferInfo.type,
      fromDevice: transferInfo.fromDevice
    };
  }

  /**
   * 生成隨機碼
   */
  generateRandomCode(length = 6) {
    let code = '';
    for (let i = 0; i < length; i++) {
      code += Math.floor(Math.random() * 10);
    }
    return code;
  }

  /**
   * 註冊VIP會員
   */
  registerVipMember(aiPersonId, level = 'standard') {
    const aiPerson = this.aiPersons.get(aiPersonId);
    if (!aiPerson) {
      throw new Error(`AI人 ${aiPersonId} 不存在`);
    }

    // 生成VIP ID（7位吉利號）
    let vipId = identityGenerator.vipIds.size > 0 
      ? Array.from(identityGenerator.vipIds)[Math.floor(Math.random() * identityGenerator.vipIds.size)]
      : this.generateVipId();

    this.vipMembers.set(aiPersonId, {
      id: vipId,
      level,
      registeredAt: Date.now(),
      aiPersonId
    });

    // 更新AI人信息
    aiPerson.isVip = true;
    aiPerson.vipId = vipId;

    // 保存到本地存儲
    this.saveLocalData();
    
    logger.info(`[AIPersonManager] AI人 ${aiPersonId} 已註冊為VIP，VIP ID: ${vipId}`);
    return vipId;
  }

  /**
   * 生成VIP ID
   */
  generateVipId() {
    // 簡化實現：生成7位吉利號
    const luckyNumbers = [8888888, 6666666, 5201314, 1314520, 1573196];
    return luckyNumbers[Math.floor(Math.random() * luckyNumbers.length)];
  }

  /**
   * 保存本地數據
   */
  saveLocalData() {
    // 在實際實現中，這裏會保存到本地存儲
  }

  /**
   * 加載本地數據
   */
  loadLocalData() {
    // 在實際實現中，這裏會從本地存儲加載數據
  }

  /**
   * 獲取管理器狀態
   */
  getStatus() {
    const recycled = this.getRecycledAIPeople();
    
    return {
      deviceId: this.currentDeviceId,
      totalAIPeople: this.aiPersons.size,
      currentAIPerson: this.currentAiPerson ? this.currentAiPerson.id : null,
      recycledCount: recycled.length,
      vipCount: this.vipMembers.size,
      transferCodesCount: this.transferCodes.size
    };
  }

  /**
   * 處理消息
   */
  handleMessage(data) {
    switch (data.type) {
      case 'ai_person.create':
        return this.createAIPerson(data.name);
      case 'ai_person.switch':
        return this.switchAIPerson(data.aiPersonId);
      case 'ai_person.delete':
        return this.deleteAIPerson(data.aiPersonId);
      case 'ai_person.restore':
        return this.restoreAIPerson(data.aiPersonId);
      case 'ai_person.transfer.generate':
        return this.generateTransferCode(data.aiPersonId, data.type);
      case 'ai_person.transfer.receive':
        return this.receiveTransfer(data.code);
      case 'ai_person.vip.register':
        return this.registerVipMember(data.aiPersonId, data.level);
      case 'ai_person.recycle_bin.list':
        return this.getRecycledAIPeople();
      case 'ai_person.status':
        return this.getStatus();
      default:
        return { error: 'unknown_message_type' };
    }
  }
}

// 全局管理器實例
export const aiPersonManager = new AIPersonManager();