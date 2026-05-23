import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import logger from './monitoring/logger.js';

const CONFIG_DIR = path.join(homedir(), '.openchat');
const SESSIONS_FILE = path.join(CONFIG_DIR, 'sessions.json');
const PROVIDERS_FILE = path.join(CONFIG_DIR, 'providers.json');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export class PersistentSessionStore {
  constructor() {
    this.sessions = new Map();
    this.providers = new Map();
    this.load();
  }

  load() {
    ensureConfigDir();

    try {
      if (fs.existsSync(SESSIONS_FILE)) {
        const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
        this.sessions = new Map(Object.entries(data));
      }
    } catch (e) {
      logger.info(`Warning: Failed to load sessions: ${e.message}`);
    }

    try {
      if (fs.existsSync(PROVIDERS_FILE)) {
        const data = JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf-8'));
        this.providers = new Map(Object.entries(data));
      }
    } catch (e) {
      logger.info(`Warning: Failed to load providers: ${e.message}`);
    }
  }

  save() {
    ensureConfigDir();

    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(this.sessions)));
    } catch (e) {
      logger.info(`Warning: Failed to save sessions: ${e.message}`);
    }

    try {
      fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(Object.fromEntries(this.providers)));
    } catch (e) {
      logger.info(`Warning: Failed to save providers: ${e.message}`);
    }
  }

  getSession(id) {
    return this.sessions.get(id);
  }

  setSession(id, data) {
    this.sessions.set(id, data);
    this.save();
  }

  deleteSession(id) {
    this.sessions.delete(id);
    this.save();
  }

  getAllSessions() {
    return Array.from(this.sessions.entries()).map(([id, data]) => ({ id, ...data }));
  }

  getProvider(id) {
    return this.providers.get(id);
  }

  setProvider(id, data) {
    this.providers.set(id, data);
    this.save();
  }

  deleteProvider(id) {
    this.providers.delete(id);
    this.save();
  }

  getAllProviders() {
    return Array.from(this.providers.entries()).map(([id, data]) => ({ id, ...data }));
  }
}

export const persistentStore = new PersistentSessionStore();