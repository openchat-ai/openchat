import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

// Dev 模式：直接用 console，不输出 JSON
const logger = isDev ? new Proxy({}, {
  get(_, level) {
    const levels = { info: 30, warn: 40, error: 50, debug: 20, fatal: 60, trace: 10 };
    const n = levels[level];
    if (!n) return () => {};
    const fn = n >= 50 ? console.error : n >= 40 ? console.warn : console.log;
    return (obj, msg, ...rest) => {
      if (typeof obj === 'string') { fn(`[${level.toUpperCase()}] ${obj}`); return; }
      const text = msg || obj?.msg || '';
      const details = rest.length ? ' ' + rest.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ') : '';
      const err = obj?.err || obj?.error;
      fn(`[${level.toUpperCase()}] ${text}${details}${err ? ' (' + (err.message || err) + ')' : ''}`);
    };
  }
}) : pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: { paths: ['req.headers.authorization', 'req.body.token', 'req.body.password', 'token', 'password', 'secret'], censor: '[REDACTED]' },
  serializers: { req: (req) => ({ method: req.method, url: req.url, headers: req.headers }), err: pino.stdSerializers.err, error: pino.stdSerializers.err },
});

export default logger;
