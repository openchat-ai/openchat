/**
 * experiments-api.mjs — bridge 端 experiment + project entry
 *
 * 5 端点:
 *   GET  /api/v1/experiments           → experiment_compose_list()
 *   POST /api/v1/experiments/:id/run   → experiment_compose_run(id, inputs)
 *   POST /api/v1/agent/chat            → experiment_22_processText (流式 SSE 走 /agent/chat/stream)
 *   POST /api/v1/agent/chat/stream     → SSE 流式: thinking/tool_call/content/complete
 *   GET  /api/v1/projects              → experiment_42_answerFromDNA('ls projects')
 *
 * 鉴权 (P0-1 修复): BRIDGE_API_TOKEN 环境变量设了之后,所有端点要求 X-Api-Token 一致
 * 例外: GET /experiments 和 GET /projects 是只读元数据,可不鉴权
 *
 * 所有 LLM 调用一律走 provider-kit (rule: R-llm-kit-1)
 */

import { Router } from 'express';
import { persistentConfig } from '../../core/core-config.mjs';

const _compose = () => import('../../experiments/experiments-all.mjs');

// === invariants ===
//   - requireApi 优先从 req.header 取 X-Api-Token,其次 X-Bridge-Token (兼容老命名)
//   - 401 + {error:'UNAUTHORIZED', hint:'set X-Api-Token header'}
//   - process.env.BRIDGE_API_TOKEN 空时: 全部端点无鉴权 (dev 模式,明确警告日志一次)
// === end invariants ===

function requireApi(req, res, next) {
  const expected = process.env.BRIDGE_API_TOKEN;
  if (!expected) {
    if (!requireApi._warned) {
      console.warn('[experiments-api] BRIDGE_API_TOKEN unset, running without auth (dev mode)');
      requireApi._warned = true;
    }
    return next();
  }
  const got = req.header('x-api-token') || req.header('x-bridge-token');
  if (got !== expected) {
    return res.status(401).json({ error: 'UNAUTHORIZED', hint: 'set X-Api-Token header to match BRIDGE_API_TOKEN' });
  }
  return next();
}

export function createExperimentsRouter() {
  const router = Router();

  // 列表 (只读,无需鉴权)
  router.get('/experiments', async (req, res, next) => {
    try {
      const ALL = await _compose();
      const items = ALL.experiment_compose_list().map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
        status: e.status,
        intelligenceLevel: e.intelligenceLevel,
        deps: e.deps || [],
        description: e.description || '',
      }));
      res.json({ total: items.length, experiments: items });
    } catch (e) { next(e); }
  });

  // 单跑 (执行 LLM,需要鉴权)
  router.post('/experiments/:id/run', requireApi, async (req, res, next) => {
    try {
      const { id } = req.params;
      const { inputs = {}, deps = {} } = req.body || {};
      const ALL = await _compose();
      const start = Date.now();
      const outputs = await ALL.experiment_compose_run(id, { inputs, deps });
      res.json({ id, durationMs: Date.now() - start, outputs });
    } catch (e) { next(e); }
  });

  // Agent chat (非流式,需要鉴权)
  router.post('/agent/chat', requireApi, async (req, res, next) => {
    try {
      const { text, chatId = 'default', role, tools, guardian } = req.body || {};
      if (!text) return res.status(400).json({ error: 'TEXT_REQUIRED' });
      const ALL = await _compose();
      await ALL.experiment_22_initProvider();
      const opts = {};
      if (role) opts.role = role;
      if (Array.isArray(tools)) opts.tools = tools;
      if (guardian !== undefined) opts.guardian = guardian;
      const start = Date.now();
      const response = await ALL.experiment_22_processText(text, chatId, opts);
      res.json({ chatId, durationMs: Date.now() - start, response });
    } catch (e) { next(e); }
  });

  // Agent chat 流式 (SSE, P0-4 修复:不再丢 thinking/tool_call 事件)
  router.post('/agent/chat/stream', requireApi, async (req, res, next) => {
    try {
      const { text, chatId = 'default', role, tools, guardian } = req.body || {};
      if (!text) return res.status(400).json({ error: 'TEXT_REQUIRED' });
      const ALL = await _compose();
      await ALL.experiment_22_initProvider();
      const opts = {};
      if (role) opts.role = role;
      if (Array.isArray(tools)) opts.tools = tools;
      if (guardian !== undefined) opts.guardian = guardian;

      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();

      const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      send('session', { chatId });
      try {
        await ALL.experiment_22_processText(text, chatId, {
          ...opts,
          onEvent: (ev) => {
            // tool-loop emit 'thinking' / 'content' / 'complete' (OrchestratorEvents)
            if (ev?.type) send(ev.type, ev);
          },
        });
        send('done', { ok: true });
      } catch (e) {
        send('error', { message: e.message });
      } finally {
        res.end();
      }
    } catch (e) { next(e); }
  });

  // Projects (只读,无需鉴权)
  router.get('/projects', async (req, res, next) => {
    try {
      const ALL = await _compose();
      const answer = await ALL.experiment_42_answerFromDNA('ls projects');
      res.json({ answer });
    } catch (e) { next(e); }
  });

  // Status (只读,无需鉴权) — mirror of slash /status
  router.get('/status', async (req, res, next) => {
    try {
      const provider = persistentConfig.getPreference('currentProvider') || 'none';
      const model = persistentConfig.getPreference('currentModel') || 'none';
      const uptime = Math.floor(process.uptime());
      res.json({ status: 'running', uptime, provider, model });
    } catch (e) { next(e); }
  });

  return router;
}
