import os from 'os';
import path from 'path';
import { persistentConfig } from '../core/persistent-config.js';
import { hasPublicAddress } from '../p2p/swarm.js';

/**
 * 解析命令行参数和持久化配置，生成完整的 CONFIG 对象
 * 读取顺序：~/.openchat/config.json bridge.* → CLI 覆盖
 */
export function parseCliArgs(argv = process.argv) {
  const args = argv.slice(2);
  const savedBridge = persistentConfig.getBridgeConfig();
  const isInteractive = args.includes('--cli') || args.includes('-i');

  const isHeadless = savedBridge.mode === 'cli' && !isInteractive ? false : !isInteractive;
  const isPublic = hasPublicAddress() || !!savedBridge.advertiseHost;

  // 支持 --port 命令行参数覆盖配置
  const portArgIndex = args.findIndex(a => a.startsWith('--port='));
  const cliPort = portArgIndex !== -1 ? parseInt(args[portArgIndex].split('=')[1]) : null;
  const port = cliPort || savedBridge.port || 3000;
  const portChanged = cliPort !== null && cliPort !== savedBridge.port;

  // 主 Bridge 判定：显式 --main 标记
  const isMain = args.includes('--main');

  // 主 Bridge 端口（fairy 需要知道往哪发心跳，默认 = 自身端口）
  const mainPortIdx = args.findIndex(a => a.startsWith('--mainPort='));
  const mainPort = mainPortIdx !== -1 ? parseInt(args[mainPortIdx].split('=')[1]) : (isMain ? port : 3800);

  const dhtPort = savedBridge.dhtPort || 0;
  const localBootstrap = savedBridge.localBootstrap || [];
  // 端口变更时，丢弃旧端口体系的直连配置
  let directListen = (portChanged ? 0 : savedBridge.directListen) || 0;
  let directConnect = portChanged ? [] : (savedBridge.directConnect || []);
  // 支持 --directListen CLI 参数
  const directListenIdx = args.findIndex(a => a.startsWith('--directListen='));
  if (directListenIdx !== -1) {
    directListen = parseInt(args[directListenIdx].split('=')[1]);
  }
  // 如果 --port 显式传入但没传 --directListen，则根据新端口重新计算
  if (portArgIndex !== -1 && directListenIdx === -1 && !args.includes('--no-direct') && !args.includes('--nesting')) {
    directListen = port + 2;
  }
  // 本地开发：无 bootstrap 时自动启用直连 TCP（端口 = HTTP 端口 + 2）
  const isNesting = args.includes('--nesting');
  if (!directListen && localBootstrap.length === 0 && !args.includes('--no-direct') && !isNesting) {
    directListen = port + 2;
  }
  const bridgeName = savedBridge.name || `bridge-${Math.random().toString(36).substr(2, 4)}`;
  const bridgeRegion = savedBridge.region || process.env.REGION || 'unknown';
  const wsSignalingUrl = savedBridge.wsSignaling || '';
  const advertiseHost = savedBridge.advertiseHost || '';
  const bridgeTopic = savedBridge.topic || 'openchat-community';
  const qiniuEnabled = savedBridge.qiniuEnabled !== false;
  const cores = savedBridge.cores || [];
  const deployServerEnabled = savedBridge.deployServerEnabled === true;
  const deployServerPort = savedBridge.deployServerPort || 8080;

  // hostId：持久标识，子进程可通过 --hostId 覆盖
  let hostId = savedBridge.hostId || '';
  const hostIdArgIndex = args.findIndex(a => a.startsWith('--hostId='));
  if (hostIdArgIndex !== -1) {
    hostId = args[hostIdArgIndex].split('=')[1];
  }
  if (!hostId) {
    hostId = persistentConfig.getHostId();
  }

  // houseId：子进程通过 --houseId 指定，默认 hostId + '_default'
  let houseIdArg = '';
  const houseIdArgIndex = args.findIndex(a => a.startsWith('--houseId='));
  if (houseIdArgIndex !== -1) {
    houseIdArg = args[houseIdArgIndex].split('=')[1];
  }
  const effectiveBodyId = houseIdArg || `${hostId}_default`;

  // --parent：nesting 子进程连接父 Bridge 的直连 TCP 端口
  const parentIndex = args.findIndex(a => a.startsWith('--parent='));
  if (parentIndex !== -1) {
    const parentPort = port + 2;
    if (!directConnect.find(d => d.host === 'localhost' && d.port === parentPort)) {
      directConnect.push({ host: 'localhost', port: parentPort });
    }
  }

  // --save-config 持久化本次设置
  if (args.includes('--save-config')) {
    persistentConfig.setBridgeConfig({
      mode: isHeadless ? 'headless' : 'cli',
      port, name: bridgeName, region: bridgeRegion,
      dhtPort, localBootstrap, directListen, directConnect,
      wsSignaling: wsSignalingUrl,
      advertiseHost,
      qiniuEnabled, cores,
      topic: bridgeTopic
    });
    console.log(`[Config] 已保存到 ${path.join(os.homedir(), '.openchat', 'config.json')}`);
  }

  const CONFIG_HOST = isPublic ? '0.0.0.0' : 'localhost';
  const CONFIG = {
    port,
    host: CONFIG_HOST,
    headless: isHeadless,
    isPublic,
    enableWebSocket: true,
    dhtPort,
    localBootstrap,
    directListen,
    directConnect,
    bridgeName,
    bridgeRegion,
    wsSignalingUrl,
    advertiseHost,
    qiniuEnabled,
    cores,
    mainPort,
    bridge: {
      port,
      name: bridgeName,
      region: bridgeRegion,
      dhtPort,
      directListen,
      directConnect,
      topic: bridgeTopic
    }
  };

  const COMMANDS = [
    'help', 'status', 'clear', 'exit', 'quit',
    'provider add', 'provider remove', 'provider list',
    'session create', 'session close', 'session list', 'session history',
    'chat'
  ];

  return {
    CONFIG,
    port,
    args,
    hostId,
    houseIdArg,
    effectiveBodyId,
    deployServerEnabled,
    deployServerPort,
    isMain,
    isNesting,
    isHeadless,
    isInteractive,
    COMMANDS
  };
}
