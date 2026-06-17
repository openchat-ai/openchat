// notifier.mjs — escalate 时通知 user (L3 责任转移: lab 决定何时打扰, user 不轮询)
//
// 配置 (env, 全部 opt-in, 没配 = 静默 noop):
//   OPENCHAT_LAB_NOTIFY    = "server"  走 Server酱 (https://sct.ftqq.com/)
//                       | "webhook"  走通用 webhook (Discord/Slack/Telegram 自适配)
//                       | 其他/不设   = off
//   OPENCHAT_LAB_SENDKEY   = Server酱 SendKey (server 模式)
//   OPENCHAT_LAB_WEBHOOK   = webhook URL (webhook 模式)
//
// 行为:
//   - escalate() 之后异步调 notify(), 不阻塞 lab 流程
//   - 网络失败只 warn, 不抛 (lab 主流程不能因为通知挂掉)
//   - 默认带 retry 1 次 (5s 后), 第二次失败就放弃
//
// 不做:
//   - 邮件 (留 L4)
//   - 多通道聚合 / 模板渲染 (留 L4)
//   - rate limit (lab 量小, 不需要)

import { execSync } from 'child_process';

function _enabled() {
  return ['server', 'webhook'].includes(process.env.OPENCHAT_LAB_NOTIFY);
}

function _truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

async function _curl(url, body, headers = {}) {
  // 用 curl 而非 fetch — 跨平台一致, 走系统代理, 不用管 IPv4/IPv6
  const json = JSON.stringify(body);
  const hdrArgs = Object.entries(headers).map(([k, v]) => `-H "${k}: ${v}"`).join(' ');
  const cmd = `curl -sS -X POST -m 10 ${hdrArgs} --data-raw '${json.replace(/'/g, "'\\''")}' "${url}"`;
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

async function _sendServer(record, key) {
  const title = `[lab] ${record.classification?.category || 'fail'} — ${_truncate(record.description, 30)}`;
  const desc = [
    `goalId: ${record.goalId}`,
    `attempts: ${record.attempts}`,
    `reason: ${_truncate(record.classification?.reason, 80)}`,
    `time: ${new Date(record.escalatedAt).toISOString()}`,
  ].join('\n\n');
  const url = `https://sctapi.ftqq.com/${key}.send`;
  return _curl(url, { title, desp: desc });
}

async function _sendWebhook(record, webhook) {
  const text = `🚨 [lab] ${record.classification?.category || 'fail'}: ${record.description}\n` +
               `attempts=${record.attempts}, reason=${record.classification?.reason || 'n/a'}`;
  // Discord/Slack 兼容: content / text 都给
  return _curl(webhook, { content: text, text });
}

export async function notify(record) {
  if (!_enabled()) return { sent: false, reason: 'notify disabled' };
  const mode = process.env.OPENCHAT_LAB_NOTIFY;
  try {
    let resp;
    if (mode === 'server') {
      const key = process.env.OPENCHAT_LAB_SENDKEY;
      if (!key) return { sent: false, reason: 'OPENCHAT_LAB_SENDKEY not set' };
      resp = await _sendServer(record, key);
    } else if (mode === 'webhook') {
      const url = process.env.OPENCHAT_LAB_WEBHOOK;
      if (!url) return { sent: false, reason: 'OPENCHAT_LAB_WEBHOOK not set' };
      resp = await _sendWebhook(record, url);
    }
    return { sent: true, mode, response: resp?.slice(0, 200) };
  } catch (err) {
    // 一次重试 (5s 后)
    try {
      await new Promise(r => setTimeout(r, 5000));
      if (mode === 'server') await _sendServer(record, process.env.OPENCHAT_LAB_SENDKEY);
      else await _sendWebhook(record, process.env.OPENCHAT_LAB_WEBHOOK);
      return { sent: true, mode, retried: true };
    } catch (err2) {
      console.debug(`[lab-notify] failed (${mode}): ${err2.message?.slice(0, 200)}`);
      return { sent: false, reason: err2.message };
    }
  }
}

// 同步入口 (lab 主流程用 fire-and-forget, 但不 await — 避免阻塞)
export function notifyFireAndForget(record) {
  notify(record).catch(err => {
    console.debug(`[lab-notify] uncaught: ${err.message?.slice(0, 200)}`);
  });
}
