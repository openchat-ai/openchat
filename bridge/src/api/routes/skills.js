/**
 * P0-04: Skills API Routes
 * 7 个端点 - 版本管理和 Skill 市场
 * 简化版：4 阶段生命周期 (Create → Validate → Publish → Use)
 */

import express from 'express'
const router = express.Router()

// 模拟 Skill 存储
const skills = new Map()
let nextSkillId = 1

// Skill 评分
const skillRatings = new Map()

// 初始化示例 Skill
const exampleSkill = {
  id: 'skill_1',
  name: 'Quick Sort Algorithm',
  description: 'Efficient sorting algorithm implementation',
  type: 'ALGORITHM',
  code: 'function quickSort(arr) { ... }',
  version: '1.0.0',
  author: 'Bridge_A',
  status: 'active',
  ratings: { average: 4.5, count: 10 },
  createdAt: '2026-04-01T00:00:00Z',
  publishedAt: '2026-04-02T00:00:00Z'
}
skills.set(exampleSkill.id, exampleSkill)

// POST /api/v1/skills - 创建 Skill
router.post('/', async (req, res, next) => {
  try {
    const { name, description, type, code, tests, documentation } = req.body

    if (!name || !type || !code) {
      return res.status(400).json({
        error: 'INVALID_SKILL_DATA',
        message: 'name, type, and code are required'
      })
    }

    const skillId = `skill_${nextSkillId++}`
    const skill = {
      id: skillId,
      name,
      description: description || '',
      type,
      code,
      tests: tests || '',
      documentation: documentation || '',
      version: '1.0.0',
      author: 'self',
      status: 'draft', // Create 阶段
      ratings: { average: 0, count: 0 },
      createdAt: new Date().toISOString(),
      validatedAt: null,
      publishedAt: null
    }

    skills.set(skillId, skill)

    res.status(201).json({
      id: skill.id,
      name: skill.name,
      type: skill.type,
      status: skill.status,
      createdAt: skill.createdAt
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/skills - 列出 Skills
router.get('/', async (req, res, next) => {
  try {
    const { type, minRating, limit = 20 } = req.query
    let skillList = Array.from(skills.values())
      .filter(s => s.status === 'active')

    if (type) {
      skillList = skillList.filter(s => s.type === type)
    }
    if (minRating) {
      skillList = skillList.filter(s => s.ratings.average >= parseFloat(minRating))
    }

    skillList = skillList.slice(0, parseInt(limit))

    res.json({
      skills: skillList,
      total: skillList.length
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/skills/search - 搜索 Skills
router.get('/search', async (req, res, next) => {
  try {
    const { query, type, minRating, limit = 20 } = req.query
    let results = Array.from(skills.values())
      .filter(s => s.status === 'active')

    if (query) {
      const q = query.toLowerCase()
      results = results.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      )
    }

    if (type) {
      results = results.filter(s => s.type === type)
    }

    if (minRating) {
      results = results.filter(s => s.ratings.average >= parseFloat(minRating))
    }

    results = results.slice(0, parseInt(limit))

    res.json({
      skills: results,
      total: results.length,
      query: query || ''
    })
  } catch (error) {
    next(error)
  }
})

// GET /api/v1/skills/:skillId - 获取 Skill 详情
router.get('/:skillId', async (req, res, next) => {
  try {
    const { skillId } = req.params
    const skill = skills.get(skillId)

    if (!skill) {
      return res.status(404).json({
        error: 'SKILL_NOT_FOUND',
        message: `Skill ${skillId} not found`
      })
    }

    res.json(skill)
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/skills/:skillId/validate - 验证 Skill（Validate 阶段）
router.post('/:skillId/validate', async (req, res, next) => {
  try {
    const { skillId } = req.params
    const skill = skills.get(skillId)

    if (!skill) {
      return res.status(404).json({
        error: 'SKILL_NOT_FOUND',
        message: `Skill ${skillId} not found`
      })
    }

    // 模拟验证过程
    skill.status = 'validating'
    skill.validatedAt = new Date().toISOString()

    // 验证通过
    skill.status = 'validated'

    skills.set(skillId, skill)

    res.json({
      id: skill.id,
      status: skill.status,
      validatedAt: skill.validatedAt
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/skills/:skillId/publish - 发布 Skill（Publish 阶段）
router.post('/:skillId/publish', async (req, res, next) => {
  try {
    const { skillId } = req.params
    const skill = skills.get(skillId)

    if (!skill) {
      return res.status(404).json({
        error: 'SKILL_NOT_FOUND',
        message: `Skill ${skillId} not found`
      })
    }

    if (skill.status !== 'validated') {
      return res.status(400).json({
        error: 'SKILL_NOT_VALIDATED',
        message: 'Skill must be validated before publishing'
      })
    }

    skill.status = 'active'
    skill.publishedAt = new Date().toISOString()

    skills.set(skillId, skill)

    res.json({
      id: skill.id,
      status: skill.status,
      publishedAt: skill.publishedAt
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/v1/skills/:skillId/rate - 评分 Skill
router.post('/:skillId/rate', async (req, res, next) => {
  try {
    const { skillId } = req.params
    const { rating, comment } = req.body
    const skill = skills.get(skillId)

    if (!skill) {
      return res.status(404).json({
        error: 'SKILL_NOT_FOUND',
        message: `Skill ${skillId} not found`
      })
    }

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        error: 'INVALID_RATING',
        message: 'Rating must be between 1 and 5'
      })
    }

    // 记录评分
    const ratings = skillRatings.get(skillId) || []
    ratings.push({ rating, comment: comment || '', createdAt: new Date().toISOString() })
    skillRatings.set(skillId, ratings)

    // 计算新平均分
    const avg = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
    skill.ratings = {
      average: Math.round(avg * 10) / 10,
      count: ratings.length
    }

    skills.set(skillId, skill)

    res.json({
      skillId: skill.id,
      rating: skill.ratings.average,
      totalRatings: skill.ratings.count
    })
  } catch (error) {
    next(error)
  }
})

export default router