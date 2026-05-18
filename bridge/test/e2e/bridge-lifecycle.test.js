import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import { spawn } from 'child_process';
import { WebSocket } from 'ws';
import http from 'http';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const PORT = 3899;
const BASE = `http://localhost:${PORT}`;
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function waitForHealth(timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (Date.now() - start > timeout) return reject(new Error('Bridge did not start'));
      http.get(`${BASE}/health`, { agent: false }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        setTimeout(poll, 800);
      }).on('error', () => setTimeout(poll, 800));
    };
    poll();
  });
}

describe('e2e: Bridge lifecycle', { timeout: 90000 }, () => {
  let proc;
  let ws1;

  before(async () => {
    proc = spawn(process.execPath, ['src/main.js', `--port=${PORT}`], {
      cwd: DIR,
      env: { ...process.env, NODE_ENV: 'test', DISABLE_API_AUTH: 'true' },
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    await waitForHealth();
  });

  after(() => {
    ws1?.close();
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
      setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 3000);
    }
  });

  test('WebSocket: connect and receive handshake', async () => {
    ws1 = new WebSocket(`ws://localhost:${PORT}/ws`);

    const msg = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('WS timeout')), 8000);
      ws1.on('message', (data) => {
        clearTimeout(t);
        resolve(JSON.parse(data.toString()));
      });
      ws1.on('error', reject);
    });

    assert.strictEqual(msg.type, 'bridge_handshake');
    assert.ok(msg.data.peerId);
    assert.ok(msg.data.clientId);

    ws1.send(JSON.stringify({ type: 'chat', data: { message: 'hi', sessionId: 'e2e-test' } }));
    await new Promise(r => setTimeout(r, 1000));
    ws1.close();
  });

  test('GET /health returns 200', async () => {
    const { statusCode, body } = await new Promise(r => {
      http.get(`${BASE}/health`, { agent: false }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => r({ statusCode: res.statusCode, body: JSON.parse(body) }));
      });
    });
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(body.status, 'ok');
  });

  test('GET / returns 200 HTML with AI residents', async () => {
    const { statusCode, body } = await new Promise(r => {
      http.get(`${BASE}/`, { agent: false }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => r({ statusCode: res.statusCode, body }));
      });
    });
    assert.strictEqual(statusCode, 200);
    assert.ok(body.includes('AI'));
  });

  test('GET /live returns live chat HTML page', async () => {
    const { statusCode, body } = await new Promise(r => {
      http.get(`${BASE}/live`, { agent: false }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => r({ statusCode: res.statusCode, body }));
      });
    });
    assert.strictEqual(statusCode, 200);
    assert.ok(body.includes('WebSocket'));
  });

  test('GET /metrics returns bridge metrics', async () => {
    const { statusCode, body } = await new Promise(r => {
      http.get(`${BASE}/metrics`, { agent: false }, res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => r({ statusCode: res.statusCode, body: JSON.parse(body) }));
      });
    });
    assert.strictEqual(statusCode, 200);
    assert.strictEqual(typeof body.uptime, 'number');
  });

  test('GET /nonexistent returns 404', async () => {
    const { statusCode } = await new Promise(r => {
      http.get(`${BASE}/nonexistent`, { agent: false }, res => {
        res.resume();
        res.on('end', () => r({ statusCode: res.statusCode }));
      });
    });
    assert.strictEqual(statusCode, 404);
  });


});
