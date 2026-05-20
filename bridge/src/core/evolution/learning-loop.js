import logger from '../logger.js';
export function startFairyMonitor() {
  // Fairy monitoring handled by BridgeSpawn + fairy-guardian
}

export function startHeartbeat(bridge, myPort, mainPort) {
  setInterval(async () => {
    try {
      await fetch(`http://localhost:${mainPort}/api/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: myPort })
      });
    } catch (e) { logger.warn('[IGNORE] ' + (e?.message || 'unknown error')); }
  }, 30000);
}
