/**
 * Residents API Routes
 * AI 居民的生命周期：出生 → 活着 → 注销
 *
 * POST   /api/v1/residents              — 出生（创建居民，可选 parentId）
 * GET    /api/v1/residents              — 全体名单
 * GET    /api/v1/residents/:id          — 居民档案
 * GET    /api/v1/residents/:id/children — 查子孙列表
 * DELETE /api/v1/residents/:id          — 注销
 */

import express from 'express';
import { residentManager } from '../../core/agent/resident-manager.js';

const router = express.Router();

// Bridge 启动时自动初始化：如无居民则创建「管家」
residentManager.initialize();

// POST /api/v1/residents — 出生（可选 parentId）
router.post('/', async (req, res, next) => {
  try {
    const { name, parentId } = req.body;
    const resident = residentManager.create(name, {
      parentId: parentId != null ? parseInt(parentId, 10) : null,
    });
    res.status(201).json(resident);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/residents — 全体名单
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const residents = residentManager.list(status || null);
    res.json({
      residents,
      total: residents.length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/residents/:id — 居民档案
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'ID 必须是数字' });
    }
    const resident = residentManager.get(id);
    if (!resident) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '居民不存在' });
    }
    res.json(resident);
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/residents/:id/children — 查子孙列表
router.get('/:id/children', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'ID 必须是数字' });
    }
    const resident = residentManager.get(id);
    if (!resident) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '居民不存在' });
    }
    const children = residentManager.getChildren(id);
    res.json({
      residentId: id,
      residentName: resident.name,
      children,
      total: children.length,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/v1/residents/:id — 注销
router.delete('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'INVALID_ID', message: 'ID 必须是数字' });
    }
    const ok = residentManager.delete(id);
    if (!ok) {
      return res.status(404).json({ error: 'NOT_FOUND', message: '居民不存在' });
    }
    res.json({ success: true, message: '居民已注销' });
  } catch (error) {
    next(error);
  }
});

export default router;
