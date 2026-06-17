import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const NEW_CONFIG_FILE = path.join(os.homedir(), '.config', 'openchat', 'config.json');

function loadNewConfig() {
  try {
    if (fs.existsSync(NEW_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(NEW_CONFIG_FILE, 'utf8'));
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.debug('[config] load error:', e.message);
  }
  return null;
}

const _config = loadNewConfig() || {};

export const persistentConfig = {
  get config() { return _config; },
};
