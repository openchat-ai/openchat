/** 基础端口 — 唯一硬编码处 */
export const DEFAULT_PORT = 3800;

/** 衍生端口偏移 */
export const PORT_OFFSETS = {
  BRIDGE_PORTS: [0, 2, 3, 4, 5, 6, 7, 8],
};

/** 获取端口（优先环境变量） */
export function getPort(envVar = 'PORT', fallback = DEFAULT_PORT) {
  const fromEnv = process.env[envVar];
  return fromEnv ? parseInt(fromEnv, 10) : fallback;
}

/** 获取 MAIN_PORT（用于 fairy-guardian 健康检查） */
export function getMainPort() {
  return getPort('MAIN_PORT', DEFAULT_PORT);
}
