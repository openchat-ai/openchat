/**
 * 启动主 Bridge 的自学习循环
 */
export function startLearningCore(bridge) {
  if (!bridge.learningCore) return;

  let cycle = 0;
  const runCycle = async () => {
    cycle++;
    try {
      const result = await bridge.learningCore.runCycle();
      if (result.status === 'solved') {
        console.log(`[学习核心] 第${cycle}轮: 解决 ${result.problem} → IQ: ${result.iq}`);
      } else if (cycle % 10 === 0) {
        console.log(`[学习核心] 第${cycle}轮: ${result.status} | IQ: ${result.iq} 年龄: ${result.age}`);
      }
    } catch (e) {
      console.log(`[学习核心] 第${cycle}轮异常: ${e.message}`);
    }
  };

  runCycle();
  bridge._learningTimer = setInterval(runCycle, 60000);
}

/**
 * 启动仙女监控（子 Bridge 监控主 Bridge 健康）
 */
export function startFairyMonitor(bridge, mainPort) {
  let downCount = 0;
  let isMainMode = false;
  const targetUrl = `http://localhost:${mainPort}/api/status`;
  const targetPort = mainPort;
  bridge._fairyMonTimer = setInterval(async () => {
    if (isMainMode) {
      try {
        const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
          console.log('[FairyMonitor] 主 Bridge 已恢复，归还主模式');
          if (bridge._learningTimer) clearInterval(bridge._learningTimer);
          bridge._learningTimer = null;
          isMainMode = false;
          downCount = 0;
          return;
        }
      } catch {}
      return;
    }

    try {
      const resp = await fetch(targetUrl, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) { downCount = 0; return; }
    } catch { downCount++; }

    if (downCount >= 3) {
      console.log('[FairyMonitor] 主 Bridge 失联，临时接管主模式');
      startLearningCore(bridge);
      await reviveMain(bridge, targetPort);
      isMainMode = true;
      downCount = 0;
    }
  }, 15000);
}

/**
 * 复活主 Bridge 进程
 */
export async function reviveMain(bridge, port) {
  try {
    const { exec } = await import('child_process');
    exec(`start "OpenChat Bridge" node src/main.js --port=${port} --main`, {
      cwd: process.cwd()
    });
    console.log(`[FairyMonitor] 复活主 Bridge :${port}`);
  } catch (e) {
    console.log(`[FairyMonitor] 复活失败: ${e.message}`);
  }
}

/**
 * 启动子 Bridge 心跳（向主 Bridge 汇报存活）
 */
export function startHeartbeat(bridge, myPort, mainPort) {
  const beatPort = myPort || 0;
  setInterval(async () => {
    try {
      await fetch(`http://localhost:${mainPort}/api/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: beatPort }),
        signal: AbortSignal.timeout(2000)
      });
    } catch {}
  }, 10000);
}
