import os from 'os';
import path from 'path';
import { persistentConfig } from '../core/persistent-config.js';
import { hasPublicAddress } from '../p2p/p2p-net.js';
import { DEFAULT_PORT } from '../constants.js';

/**
 * 瑙ｆ瀽鍛戒护琛屽弬鏁板拰鎸佷箙鍖栭厤缃紝鐢熸垚瀹屾暣鐨?CONFIG 瀵硅薄
 * 璇诲彇椤哄簭锛殈/.openchat/config.json bridge.* 鈫?CLI 瑕嗙洊
 */
export function parseCliArgs(argv = process.argv) {
  const args = argv.slice(2);
  const savedBridge = persistentConfig.getBridgeConfig();
  const isInteractive = args.includes('--cli') || args.includes('-i');

  const isHeadless = savedBridge.mode === 'cli' && !isInteractive ? false : !isInteractive;
  const isPublic = hasPublicAddress() || !!savedBridge.advertiseHost;

  // --port CLI arg overrides config file port
  const portArgIndex = args.findIndex(a => a.startsWith('--port='));
  const cliPort = portArgIndex !== -1 ? parseInt(args[portArgIndex].split('=')[1]) : null;
  const port = cliPort || savedBridge.port || DEFAULT_PORT;
  const portChanged = cliPort !== null && cliPort !== savedBridge.port;

  // --main flag marks this Bridge as main (fairy heartbeat target)
  const isMain = args.includes('--main');

  // --mainPort overrides the main Bridge port for fairy heartbeats
  const mainPortIdx = args.findIndex(a => a.startsWith('--mainPort='));
  const defaultMainPort = parseInt(process.env.MAIN_PORT || String(DEFAULT_PORT), 10);
  const mainPort = mainPortIdx !== -1 ? parseInt(args[mainPortIdx].split('=')[1]) : (isMain ? port : defaultMainPort);

  const dhtPort = savedBridge.dhtPort || 0;
  const localBootstrap = savedBridge.localBootstrap || [];
  // 绔彛鍙樻洿鏃讹紝涓㈠純鏃х鍙ｄ綋绯荤殑鐩磋繛閰嶇疆
  let directListen = (portChanged ? 0 : savedBridge.directListen) || 0;
  let directConnect = portChanged ? [] : (savedBridge.directConnect || []);
  // 鏀寔 --directListen CLI 鍙傛暟
  const directListenIdx = args.findIndex(a => a.startsWith('--directListen='));
  if (directListenIdx !== -1) {
    directListen = parseInt(args[directListenIdx].split('=')[1]);
  }
  // When --port is explicit but --directListen not given, derive from port+2
  if (portArgIndex !== -1 && directListenIdx === -1 && !args.includes('--no-direct') && !args.includes('--nesting')) {
    directListen = port + 2;
  }
  // --nesting flag: run as nested process (no direct TCP)
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

  // hostId锛氭寔涔呮爣璇嗭紝瀛愯繘绋嬪彲閫氳繃 --hostId 瑕嗙洊
  let hostId = savedBridge.hostId || '';
  const hostIdArgIndex = args.findIndex(a => a.startsWith('--hostId='));
  if (hostIdArgIndex !== -1) {
    hostId = args[hostIdArgIndex].split('=')[1];
  }
  if (!hostId) {
    hostId = persistentConfig.getHostId();
  }

  // houseId锛氬瓙杩涚▼閫氳繃 --houseId 鎸囧畾锛岄粯璁?hostId + '_default'
  let houseIdArg = '';
  const houseIdArgIndex = args.findIndex(a => a.startsWith('--houseId='));
  if (houseIdArgIndex !== -1) {
    houseIdArg = args[houseIdArgIndex].split('=')[1];
  }
  const effectiveBodyId = houseIdArg || `${hostId}_default`;

  // --parent锛歯esting 瀛愯繘绋嬭繛鎺ョ埗 Bridge 鐨勭洿杩?TCP 绔彛
  const parentIndex = args.findIndex(a => a.startsWith('--parent='));
  if (parentIndex !== -1) {
    const parentPort = port + 2;
    if (!directConnect.find(d => d.host === 'localhost' && d.port === parentPort)) {
      directConnect.push({ host: 'localhost', port: parentPort });
    }
  }

  // --save-config 持久化本次配置
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
    console.log(`[Config] 宸蹭繚瀛樺埌 ${path.join(os.homedir(), '.openchat', 'config.json')}`);
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
