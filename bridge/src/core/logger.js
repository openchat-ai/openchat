import pino from 'pino';
import path from 'path';
import os from 'os';

const isDev = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isDev ? 'debug' : 'info'),
  redact: {
    paths: ['req.headers.authorization', 'req.body.token', 'req.body.password', 'token', 'password', 'secret'],
    censor: '[REDACTED]',
  },
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      headers: req.headers,
    }),
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
});

export default logger;
