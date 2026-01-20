import { createLogger, type Logger } from '@connectors/core-logging';
import { calculateBackoffDelay, sleep, type BackoffConfig } from '@connectors/core-rate-limit';

import { buildGraphUrl, DEFAULT_API_VERSION, DEFAULT_BASE_URL, maskNumeric } from './helpers.js';
import { buildMetaGraphError, MetaGraphClientError, MetaGraphError, MetaGraphNetworkError, MetaGraphTimeoutError } from './errors.js';

export type GraphTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GraphClientContext {
  connector?: string;
  capabilityId?: string;
  correlationId?: string;
  channel?: string;
  requestName?: string;
}

export interface GraphClientConfig {
  accessToken: string;
  apiVersion?: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  defaultTimeoutMs?: number;
  retry?: Partial<BackoffConfig>;
  transport?: GraphTransport;
  logger?: Logger;
  context?: GraphClientContext;
}

export interface GraphRequestOptions {
  path: string;
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  correlationId?: string;
  retry?: Partial<BackoffConfig>;
}

export interface GraphResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T | undefined;
}

export interface GraphClient {
  request: <T = unknown>(options: GraphRequestOptions) => Promise<GraphResponse<T>>;
  post: <T = unknown>(
    path: string,
    body: unknown,
    options?: Omit<GraphRequestOptions, 'path' | 'method' | 'body'>
  ) => Promise<GraphResponse<T>>;
}

const DEFAULT_RETRY_CONFIG: Partial<BackoffConfig> = {
  initialDelayMs: 300,
  maxDelayMs: 5000,
  multiplier: 2,
  jitter: false,
  maxRetries: 2 // total attempts = 1 + maxRetries
};

function headersToObject(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

function shouldSerializeAsJson(body: unknown): boolean {
  if (body === undefined || body === null) return false;
  if (typeof body === 'string') return false;
  if (body instanceof URLSearchParams || body instanceof FormData || body instanceof Blob) return false;
  return true;
}

function buildRequestBody(body: unknown): { serialized?: BodyInit; contentType?: string } {
  if (body === undefined || body === null) {
    return {};
  }

  if (shouldSerializeAsJson(body)) {
    return { serialized: JSON.stringify(body), contentType: 'application/json' };
  }

  return { serialized: body as BodyInit, contentType: undefined };
}

function createAbortSignal(timeoutMs?: number): AbortSignal | undefined {
  if (!timeoutMs) return undefined;
  try {
    return AbortSignal.timeout(timeoutMs);
  } catch {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs);
    return controller.signal;
  }
}

function normalizeError(error: unknown, status?: number, body?: unknown, headers?: Record<string, string>): MetaGraphError {
  if (error instanceof MetaGraphError) {
    return error;
  }

  if (error instanceof Error) {
    const message = error.message || 'Meta Graph request failed';
    if (error.name === 'AbortError' || message.toLowerCase().includes('timeout')) {
      return new MetaGraphTimeoutError(message, { status, raw: body });
    }

    if (!status) {
      return new MetaGraphNetworkError(message, { status, raw: body });
    }

    return buildMetaGraphError(message, status, body, headers);
  }

  return buildMetaGraphError('Meta Graph request failed', status, body, headers);
}

function buildLogger(config: GraphClientConfig): Logger {
  return config.logger ?? createLogger({ service: 'core-meta-graph', component: 'graph-client', provider: 'meta' });
}

export function createGraphClient(config: GraphClientConfig): GraphClient {
  const accessToken = config.accessToken;
  const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION;
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const transport = config.transport ?? fetch;
  const logger = buildLogger(config);
  const defaultRetry = { ...DEFAULT_RETRY_CONFIG, ...(config.retry ?? {}) };
  const defaultTimeoutMs = config.defaultTimeoutMs;

  const baseContext = {
    connector: config.context?.connector,
    capabilityId: config.context?.capabilityId,
    channel: config.context?.channel,
    requestName: config.context?.requestName,
    correlationId: config.context?.correlationId
  };

  const request = async <T = unknown>(options: GraphRequestOptions): Promise<GraphResponse<T>> => {
    const method = options.method ?? 'POST';
    const url = buildGraphUrl(baseUrl, apiVersion, options.path, options.query);
    const retryConfig = { ...defaultRetry, ...(options.retry ?? {}) };
    const maxRetries =
      typeof retryConfig.maxRetries === 'number' && Number.isFinite(retryConfig.maxRetries)
        ? retryConfig.maxRetries
        : DEFAULT_RETRY_CONFIG.maxRetries ?? 0;
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    const correlationId = options.correlationId ?? baseContext.correlationId;
    const context = {
      ...baseContext,
      correlationId,
      endpoint: options.path,
      method
    };

    const { serialized, contentType } = buildRequestBody(options.body);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(config.defaultHeaders ?? {}),
      ...(options.headers ?? {})
    };

    let attempt = 0;

    while (true) {
      const startedAt = Date.now();
      try {
        const response = await transport(url, {
          method,
          headers,
          body: serialized,
          signal: createAbortSignal(timeoutMs)
        });

        const rawText = await response.text();
        let parsedBody: unknown;
        if (rawText) {
          try {
            parsedBody = JSON.parse(rawText) as unknown;
          } catch {
            parsedBody = rawText;
          }
        }

        if (response.ok) {
          const latencyMs = Date.now() - startedAt;
          logger.info('meta graph request succeeded', {
            ...context,
            channel: baseContext.channel,
            status: response.status,
            attempt: attempt + 1,
            latencyMs,
            retryable: false
          });

          return {
            status: response.status,
            headers: headersToObject(response.headers),
            data: parsedBody as T
          };
        }

        const graphError = buildMetaGraphError(
          parsedBody && typeof parsedBody === 'object' && 'error' in (parsedBody as Record<string, unknown>)
            ? ((parsedBody as { error?: { message?: string } }).error?.message ??
                'Meta Graph request failed with error payload')
            : `Meta Graph request failed with status ${response.status}`,
          response.status,
          parsedBody,
          headersToObject(response.headers)
        );

        const latencyMs = Date.now() - startedAt;
          logger.warn('meta graph request failed', {
            ...context,
            channel: baseContext.channel,
            status: graphError.status ?? response.status,
            attempt: attempt + 1,
            latencyMs,
          retryable: graphError.retryable,
          retryAfterMs: graphError.retryAfterMs,
          errorCode: graphError.code,
          graphCode: graphError.graphCode,
          graphSubcode: graphError.graphSubcode,
          fbtraceId: graphError.fbtraceId,
          errorMessage: maskNumeric(graphError.message ?? '')
        });

        if (!graphError.retryable || attempt >= maxRetries) {
          throw graphError;
        }

        const backoffDelay = calculateBackoffDelay(attempt, retryConfig);
        const delayMs = Math.max(backoffDelay, graphError.retryAfterMs ?? 0);
        attempt += 1;
        logger.info('meta graph retrying request', {
          ...context,
          attempt: attempt + 1,
          delayMs,
          maxRetries
        });
        await sleep(delayMs);
      } catch (error) {
        const graphError = normalizeError(
          error,
          error instanceof MetaGraphError ? error.status : undefined,
          error instanceof MetaGraphError ? error.raw : undefined,
          headers
        );
        const latencyMs = Date.now() - startedAt;

        logger.warn('meta graph transport error', {
          ...context,
          channel: baseContext.channel,
          status: graphError.status,
          attempt: attempt + 1,
          latencyMs,
          retryable: graphError.retryable,
          retryAfterMs: graphError.retryAfterMs,
          errorCode: graphError.code,
          graphCode: graphError.graphCode,
          graphSubcode: graphError.graphSubcode,
          fbtraceId: graphError.fbtraceId,
          errorMessage: maskNumeric(graphError.message ?? '')
        });

        if (graphError instanceof MetaGraphClientError || !graphError.retryable || attempt >= maxRetries) {
          throw graphError;
        }

        const backoffDelay = calculateBackoffDelay(attempt, retryConfig);
        const delayMs = Math.max(backoffDelay, graphError.retryAfterMs ?? 0);
        attempt += 1;
        logger.info('meta graph retrying request', {
          ...context,
          attempt: attempt + 1,
          delayMs,
          maxRetries
        });
        await sleep(delayMs);
      }
    }
  };

  const post = async <T = unknown>(
    path: string,
    body: unknown,
    options?: Omit<GraphRequestOptions, 'path' | 'method' | 'body'>
  ) => request<T>({ ...(options ?? {}), path, method: 'POST', body });

  return { request, post };
}
