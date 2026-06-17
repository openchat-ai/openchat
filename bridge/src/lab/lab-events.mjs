// lab-events.mjs — 事件总线, fire-and-forget, 推 /lab WebSocket
//
// 设计: 单进程 EventEmitter + file watcher (跨进程)
//   - 写 jsonl 是 source of truth, 事件只是"刚才变了"信号
//   - 客户端收到事件就 re-fetch 相应 API (不强同步 payload)
//   - 失败/没人订阅 → silently drop, 不影响主流程
//
// 跨进程问题:
//   - lab.mjs CLI (run-next / add) 跟 bridge 是不同进程
//   - 直接 emit 只能被同进程订阅者收到
//   - 所以这里加 file watcher: 监听 jsonl 文件变化, emit 事件
//   - 进程内直接 emit 也保留 (immediate, 避免 watcher 1-2s 延迟)
//
// 事件清单:
//   'queue'    {type: 'added'|'updated', goal, fromWatcher?}  // goal-queue.mjs / watcher
//   'history'  {type: 'added', run, fromWatcher?}             // history.mjs / watcher
//   'escalate' {record, fromWatcher?}                         // escalate.mjs / watcher
//   'runner'   {type: 'start'|'finish', goalId, ...}          // runner.mjs (只进程内)
//
// 用法:
//   import { labEvents } from './lab-events.mjs';
//   labEvents.emit('queue', {type: 'added', goal});
//   labEvents.on('queue', (evt) => { ... });

import { EventEmitter } from 'events';
import { watch, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// === invariants ===
// - HTTP 调用使用 AbortSignal.timeout 超时保护
// - try/catch 覆盖所有外部 IO 调用
// - 事件发射使用 fire-and-forget，不阻塞调用方

const LAB_DIR = join(homedir(), '.openchat', 'lab');

class LabEvents extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);  // 多个 WS client + 调试监听
    this._watchers = new Map();  // file path → FSWatcher
    this._lastSize = {};         // file → last known size (避免重复 emit)
  }

  /**
   * 启动 file watcher, 跨进程感知 jsonl 变化
   * 同一文件多次启动会被 dedupe
   */
  startWatcher(file, channel) {
    const fullPath = join(LAB_DIR, file);
    if (this._watchers.has(fullPath)) return;
    if (!existsSync(fullPath)) {
      // 文件可能还不存在, 等创建后再 watch
      // 简单做法: 50ms 后重试, 最多 20 次 (1s)
      let retries = 20;
      const tryWatch = () => {
        if (existsSync(fullPath)) {
          this._doWatch(fullPath, channel);
        } else if (--retries > 0) {
          setTimeout(tryWatch, 50);
        }
      };
      tryWatch();
      return;
    }
    this._doWatch(fullPath, channel);
  }

  _doWatch(fullPath, channel) {
    try {
      const w = watch(fullPath, { persistent: true }, (eventType) => {
        if (eventType === 'change') {
          // 检查 size 变化避免 debounce 期间重复
          // (fs.watch 在某些平台上会重复 fire)
          let size = 0;
          try { size = statSync(fullPath).size; } catch (e) { console.error('[C0]', e); }
          if (this._lastSize[fullPath] === size) return;
          this._lastSize[fullPath] = size;
          this.emit(channel, { type: 'changed', fromWatcher: true });
        }
      });
      w.on('error', () => {});  // 文件被删/重建不抛
      this._watchers.set(fullPath, w);
    } catch (e) {
      // watch 失败不抛, 进程内 emit 仍能用
    }
  }

  stopAllWatchers() {
    for (const w of this._watchers.values()) {
      try { w.close(); } catch (e) { console.error('[C0]', e); }
    }
    this._watchers.clear();
  }
}

export const labEvents = new LabEvents();

// 不在 module 顶层自动 startWatcher — 留给 initLabWatchers()
// (lab.mjs CLI 不需要 watcher, 自动启会让 process 不退出)
let _initialized = false;
export function initLabWatchers() {
  if (_initialized) return;
  _initialized = true;
  labEvents.startWatcher('queue.jsonl', 'queue');
  labEvents.startWatcher('history.jsonl', 'history');
  labEvents.startWatcher('escalated.jsonl', 'escalate');
}
