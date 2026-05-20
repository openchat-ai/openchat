/**
 * CLI entry — starts Bridge with interactive prompt.
 * Usage: node src/cli-entry.js [options]
 */
import { Bridge } from './core/bridge-lifecycle.js';
import { parseCliArgs } from './core/cli-args.js';

const CONFIG = parseCliArgs(process.argv);
process.env.OPENCHAT_DATA_DIR = CONFIG.dataDir || process.env.OPENCHAT_DATA_DIR;

const bridge = new Bridge();
await bridge.start(CONFIG);
