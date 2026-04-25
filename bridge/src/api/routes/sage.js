/**
 * Sage API — 智者（天人点拨）路由
 *
 * GET  /api/v1/sage/:residentId  → 查看对话记录
 * POST /api/v1/sage/:residentId/answer → 回答提问
 * POST /api/v1/sage/:residentId/guide  → 主动点拨
 */

import express from 'express';
import { sageManager } from '../../core/sage.js';

const router = express.Router();

/**
 * GET /api/v1/sage/:residentId
 * 获取与某居民的完整对话记录
 */
router.get('/:residentId', (req, res, next) => {
  try {
    const id = parseInt(req.params.residentId, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'ID 必须是数字' });
    }
    const records = sageManager.getConversation(id);
    res.json({ records, total: records.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/v1/sage/:residentId/answer
 * 智者回答居民的提问
 * Body: { recordId, content }
 */
router.post('/:residentId/answer', (req, res, next) => {
  try {
    const id = parseInt(req.params.residentId, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'ID 必须是数字' });
    }

    const { recordId, content } = req.body;
    if (!recordId || !content) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'recordId 和 content 为必填',
      });
    }

    const record = sageManager.answer(id, recordId, content);
    res.status(201).json({ success: true, record });
  } catch (error) {
    if (error.message.startsWith('Sage record')) {
      return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
    }
    next(error);
  }
});

/**
 * POST /api/v1/sage/:residentId/guide
 * 智者主动点拨（鼓励/指导）
 * Body: { content, type: 'guide'|'praise' }
 */
router.post('/:residentId/guide', (req, res, next) => {
  try {
    const id = parseInt(req.params.residentId, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'ID 必须是数字' });
    }

    const { content, type } = req.body;
    if (!content) {
      return res.status(400).json({
        error: 'MISSING_FIELDS',
        message: 'content 为必填',
      });
    }

    const guideType = type === 'praise' ? 'praise' : 'guide';
    const record = sageManager.guide(id, content, guideType);
    res.status(201).json({ success: true, record });
  } catch (error) {
    next(error);
  }
});

export default router;
