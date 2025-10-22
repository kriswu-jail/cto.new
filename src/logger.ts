type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const format = (level: LogLevel, message: string, meta?: unknown) => {
  const time = new Date().toISOString();
  if (meta === undefined) {
    return `[${time}] [${level.toUpperCase()}] ${message}`;
  }
  return `[${time}] [${level.toUpperCase()}] ${message} ${JSON.stringify(meta)}.`;
};

export const logger = {
  debug(message: string, meta?: unknown) {
    console.debug(format('debug', message, meta));
  },
  info(message: string, meta?: unknown) {
    console.info(format('info', message, meta));
  },
  warn(message: string, meta?: unknown) {
    console.warn(format('warn', message, meta));
  },
  error(message: string, meta?: unknown) {
    console.error(format('error', message, meta));
  },
};
