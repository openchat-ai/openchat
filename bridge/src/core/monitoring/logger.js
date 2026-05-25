import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const logger = isDev
  ? pino({ level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } })
  : pino({
      level: 'info',
      redact: {
        paths: ['req.headers.authorization', 'req.body.token', 'req.body.password', 'token', 'password', 'secret'],
        censor: '[REDACTED]',
      },
    });

export default logger;
