import { parseRetryAfter } from './helpers.js';

export type MetaGraphErrorCode =
  | 'auth_error'
  | 'rate_limit'
  | 'client_error'
  | 'server_error'
  | 'network_error'
  | 'timeout'
  | 'unknown_error';

export type GraphErrorBody = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  is_transient?: boolean;
  fbtrace_id?: string;
  error_data?: Record<string, unknown>;
};

export type GraphErrorResponse = {
  error?: GraphErrorBody;
};

export type ErrorClassification = {
  code: MetaGraphErrorCode;
  retryable: boolean;
  retryAfterMs?: number;
};

export interface MetaGraphErrorOptions extends Partial<GraphErrorBody> {
  status?: number;
  retryAfterMs?: number;
  retryable?: boolean;
  raw?: unknown;
}

export class MetaGraphError extends Error {
  readonly code: MetaGraphErrorCode;
  readonly status?: number;
  readonly graphType?: string;
  readonly graphCode?: number;
  readonly graphSubcode?: number;
  readonly fbtraceId?: string;
  readonly retryAfterMs?: number;
  readonly retryable: boolean;
  readonly isTransient?: boolean;
  readonly raw?: unknown;

  constructor(code: MetaGraphErrorCode, message: string, options: MetaGraphErrorOptions = {}) {
    super(message);
    this.name = 'MetaGraphError';
    this.code = code;
    this.status = options.status;
    this.graphType = options.type;
    this.graphCode = options.code;
    this.graphSubcode = options.error_subcode;
    this.fbtraceId = options.fbtrace_id;
    this.retryAfterMs = options.retryAfterMs;
    this.retryable = options.retryable ?? false;
    this.isTransient = options.is_transient;
    this.raw = options.raw;
  }
}

export class MetaGraphAuthError extends MetaGraphError {
  constructor(message: string, options: MetaGraphErrorOptions = {}) {
    super('auth_error', message, { retryable: false, ...options });
    this.name = 'MetaGraphAuthError';
  }
}

export class MetaGraphRateLimitError extends MetaGraphError {
  constructor(message: string, options: MetaGraphErrorOptions = {}) {
    super('rate_limit', message, { retryable: true, ...options });
    this.name = 'MetaGraphRateLimitError';
  }
}

export class MetaGraphClientError extends MetaGraphError {
  constructor(message: string, options: MetaGraphErrorOptions = {}) {
    super('client_error', message, { retryable: false, ...options });
    this.name = 'MetaGraphClientError';
  }
}

export class MetaGraphServerError extends MetaGraphError {
  constructor(message: string, options: MetaGraphErrorOptions = {}) {
    super('server_error', message, { retryable: true, ...options });
    this.name = 'MetaGraphServerError';
  }
}

export class MetaGraphNetworkError extends MetaGraphError {
  constructor(message: string, options: MetaGraphErrorOptions = {}) {
    super('network_error', message, { retryable: true, ...options });
    this.name = 'MetaGraphNetworkError';
  }
}

export class MetaGraphTimeoutError extends MetaGraphError {
  constructor(message: string, options: MetaGraphErrorOptions = {}) {
    super('timeout', message, { retryable: true, ...options });
    this.name = 'MetaGraphTimeoutError';
  }
}

export class MetaGraphUnknownError extends MetaGraphError {
  constructor(message: string, options: MetaGraphErrorOptions = {}) {
    super('unknown_error', message, { retryable: false, ...options });
    this.name = 'MetaGraphUnknownError';
  }
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const AUTH_ERROR_CODES = new Set([10, 102, 104, 190, 200, 250]);

function getHeader(headers?: Headers | Record<string, string>, key?: string): string | null {
  if (!headers || !key) return null;

  if (headers instanceof Headers) {
    return headers.get(key);
  }

  const found = Object.entries(headers).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return found ? found[1] : null;
}

export function classifyError(
  status: number | undefined,
  graphError?: GraphErrorBody,
  headers?: Headers | Record<string, string>
): ErrorClassification {
  const retryAfterMs = parseRetryAfter(getHeader(headers, 'retry-after'));

  if (status === 429 || (graphError?.code && RATE_LIMIT_CODES.has(graphError.code))) {
    return { code: 'rate_limit', retryable: true, retryAfterMs };
  }

  if (graphError?.is_transient) {
    return { code: 'server_error', retryable: true, retryAfterMs };
  }

  if (status === 401 || status === 403 || (graphError?.code && AUTH_ERROR_CODES.has(graphError.code))) {
    return { code: 'auth_error', retryable: false };
  }

  if (status && status >= 500) {
    return { code: 'server_error', retryable: true, retryAfterMs };
  }

  if (status && status >= 400) {
    return { code: 'client_error', retryable: false };
  }

  return { code: 'unknown_error', retryable: false, retryAfterMs };
}

export function extractGraphError(raw: unknown): GraphErrorBody | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  if ('error' in raw && raw.error && typeof raw.error === 'object') {
    const candidate = (raw as { error?: unknown }).error;
    if (candidate && typeof candidate === 'object') {
      const { message, type, code, error_subcode, error_user_title, error_user_msg, is_transient, fbtrace_id, error_data } =
        candidate as GraphErrorBody;
      return {
        message,
        type,
        code,
        error_subcode,
        error_user_title,
        error_user_msg,
        is_transient,
        fbtrace_id,
        error_data
      };
    }
  }

  return undefined;
}

export function buildMetaGraphError(
  message: string,
  status: number | undefined,
  body: unknown,
  headers?: Headers | Record<string, string>
): MetaGraphError {
  const graphError = extractGraphError(body);
  const classification = classifyError(status, graphError, headers);
  const opts: MetaGraphErrorOptions = {
    status,
    retryAfterMs: classification.retryAfterMs,
    retryable: classification.retryable,
    raw: graphError,
    ...graphError
  };

  switch (classification.code) {
    case 'auth_error':
      return new MetaGraphAuthError(message, opts);
    case 'rate_limit':
      return new MetaGraphRateLimitError(message, opts);
    case 'client_error':
      return new MetaGraphClientError(message, opts);
    case 'server_error':
      return new MetaGraphServerError(message, opts);
    case 'network_error':
      return new MetaGraphNetworkError(message, opts);
    case 'timeout':
      return new MetaGraphTimeoutError(message, opts);
    case 'unknown_error':
    default:
      return new MetaGraphUnknownError(message, opts);
  }
}
