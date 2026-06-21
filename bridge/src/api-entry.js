/**
 * API entry — starts Bridge as headless API server.
 * Usage: node src/api-entry.js [options]
 * Default: headless mode on port 3800
 */
import { Bridge } from './main.js';
import { parseCliArgs } from './core/core-bootstrap.mjs';

const CONFIG = parseCliArgs(process.argv);
CONFIG.headless = true;

const bridge = new Bridge();
await bridge.start(CONFIG);
