import pino from 'pino';
import { getEnv } from './env.js';

let cached: pino.Logger | null = null;

export function log(): pino.Logger {
  if (cached) return cached;
  const env = getEnv();
  cached = pino({
    level: env.LOG_LEVEL,
    transport:
      env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' } }
        : undefined,
    base: { svc: 'icp-agent' },
  });
  return cached;
}
