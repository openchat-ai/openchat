import 'dotenv/config';
import { parseCliArgs } from './config/cli-args.js';
import Bridge from './core/bridge.js';

const parsedConfig = parseCliArgs();
const { CONFIG } = parsedConfig;

export async function startBridge(detectedTools = [], options = {}) {
  if (options.headless !== undefined) CONFIG.headless = options.headless;
  if (options.port) CONFIG.port = options.port;
  if (options.host) CONFIG.host = options.host;

  const bridge = new Bridge(CONFIG, parsedConfig);
  await bridge.start(detectedTools);
}

const mainPath = process.argv[1];
const normalizedMainPath = mainPath ? mainPath.replace(/\\/g, '/') : '';
const importPath = import.meta.url.replace('file://', '');
const isMainModule = normalizedMainPath && (
  importPath === normalizedMainPath ||
  importPath.endsWith('/' + normalizedMainPath) ||
  normalizedMainPath.endsWith(importPath)
);

if (isMainModule) {
  startBridge().catch(e => {
    console.error('Bridge start failed:', e.message);
    process.exit(1);
  });
}
