/**
 * 验证 OPENCHAT_HOME 环境变量是否生效
 */
import { persistentConfig } from '../src/core/persistent-config.js';

// 读取配置中的端口
const cfg = persistentConfig.getBridgeConfig();
console.log('Current port:', cfg.port);
console.log('Expected: 3000 (from OPENCHAT_HOME config)');
console.log('OPENCHAT_HOME:', process.env.OPENCHAT_HOME);
console.log('实际读取的config文件:', process.env.OPENCHAT_HOME + '/config.json');
