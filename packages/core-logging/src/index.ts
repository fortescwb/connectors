import type { TenantId } from '@connectors/core-tenant';

export type LoggerContext = {
  tenantId?: TenantId;
  correlationId?: string;
  eventId?: string;
  eventType?: string;
  [key: string]: unknown;
};

export type Logger = {
  info: (message: string, context?: LoggerContext) => void;
  warn: (message: string, context?: LoggerContext) => void;
  error: (message: string, context?: LoggerContext) => void;
};

function serializeEntry(level: 'info' | 'warn' | 'error', message: string, context?: LoggerContext) {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context
  };

  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined && value !== null)
  );
}

export function createLogger(baseContext: LoggerContext = {}): Logger {
  const write = (level: 'info' | 'warn' | 'error', message: string, context?: LoggerContext) => {
    const payload = serializeEntry(level, message, { ...baseContext, ...context });
    const serialized = JSON.stringify(payload);
    // Always use console.log to emit all logs to stdout (never stderr)
    // The level is included as a field in the JSON payload
    console.log(serialized);
  };

  return {
    info: (message, context) => write('info', message, context),
    warn: (message, context) => write('warn', message, context),
    error: (message, context) => write('error', message, context)
  };
}
