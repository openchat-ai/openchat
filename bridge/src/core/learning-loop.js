export function startFairyMonitor(bridge, mainPort) {
  let cycle = 0;
  const check = async () => {
    cycle++;
    try {
      const guardian = bridge.learningCore?.guardian;
      if (guardian) {
        await guardian.checkAll();
        if (cycle % 10 === 0) {
          console.log('[FairyMonitor] checked ' + cycle + ' times');
        }
      }
    } catch {}
  };
  setInterval(check, 60000);
}

export function startHeartbeat(bridge, myPort, mainPort) {
  setInterval(async () => {
    try {
      await fetch(`http://localhost:${mainPort}/api/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: myPort })
      });
    } catch {}
  }, 30000);
}
