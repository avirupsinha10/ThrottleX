import winston from 'winston';

const isDevelopment = (process.env['NODE_ENV'] ?? 'development') === 'development';
const { combine, timestamp, json, colorize, simple } = winston.format;

export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] ?? (isDevelopment ? 'debug' : 'info'),
  format: isDevelopment
    ? combine(colorize(), timestamp(), simple())
    : combine(timestamp(), json()),
  defaultMeta: { service: 'throttlex' },
  transports: [new winston.transports.Console()],
});
