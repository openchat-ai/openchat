#!/usr/bin/env node
/**
 * API Server Launcher
 * 启动独立的 API 服务器
 */

import APIServer from '../src/api/server.js';
import P2PSwarm from '../src/p2p/swarm.js';
import healthCheck from '../src/monitoring/health-check.js';
import metrics from '../src/api/middleware/metrics.js';

const args = process.argv.slice(2);
const port = parseInt(args.find(a => a.startsWith('--port='))?.split('=')[1]) || 3001;
const enableP2P = args.includes('--p2p');
const verbose = args.includes('-v') || args.includes('--verbose');

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════╗
║   OpenChat API Server                              ║
║   Port: ${port}                                    ║
║   P2P: ${enableP2P ? 'Enabled' : 'Disabled'}                               ║
╚═══════════════════════════════════════════════════╝
  `);

  // 启动 API 服务器
  const apiServer = new APIServer({ port });
  await apiServer.start();

  // 启动 P2P（如果启用）
  let p2pSwarm = null;
  if (enableP2P) {
    p2pSwarm = new P2PSwarm();
    try {
      await p2pSwarm.start();
      console.log('[Main] P2P Swarm started');
    } catch (error) {
      console.error('[Main] P2P start failed:', error.message);
    }
  }

  // 定期健康检查
  setInterval(async () => {
    const health = await healthCheck.check();
    if (!health.healthy && verbose) {
      console.log('[Health]', health.overall, health.checks);
    }
  }, 30000);

  // 优雅关闭
  process.on('SIGINT', async () => {
    console.log('\n[Main] Shutting down...');

    if (p2pSwarm) {
      await p2pSwarm.stop();
    }
    await apiServer.stop();
    metrics.destroy();

    console.log('[Main] Done');
    process.exit(0);
  });

  console.log('[Main] API Server running. Press Ctrl+C to stop.');
}

main().catch(err => {
  console.error('[Main] Error:', err.message);
  process.exit(1);
});