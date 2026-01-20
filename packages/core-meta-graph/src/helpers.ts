export const DEFAULT_BASE_URL = 'https://graph.facebook.com';
export const DEFAULT_API_VERSION = 'v19.0';

function trimSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function ensurePath(value: string): string {
  return value.startsWith('/') ? value.slice(1) : value;
}

function hasVersionPrefix(path: string): boolean {
  return /^v\d+\.\d+\//.test(path);
}

/**
 * Build a Meta Graph API URL from base, version, path, and query params.
 * Handles paths with/without leading slash and avoids double version prefixes.
 */
export function buildGraphUrl(
  baseUrl: string,
  apiVersion: string,
  path: string,
  query?: Record<string, string | number | undefined>
): string {
  const normalizedBase = trimSlashes(baseUrl || DEFAULT_BASE_URL);
  const normalizedPath = ensurePath(path);
  const isAbsolute = /^https?:\/\//i.test(normalizedPath);
  const versionedPath = isAbsolute
    ? normalizedPath
    : hasVersionPrefix(normalizedPath)
      ? normalizedPath
      : `${apiVersion}/${normalizedPath}`;
  const url = isAbsolute ? normalizedPath : `${normalizedBase}/${versionedPath}`;

  if (!query) {
    return url;
  }

  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    searchParams.append(key, String(value));
  }

  const queryString = searchParams.toString();
  return queryString ? `${url}?${queryString}` : url;
}

/**
 * Mask sensitive tokens by keeping a small prefix/suffix visible.
 */
export function maskAccessToken(token: string): string {
  if (!token) return '***';
  if (token.length <= 6) return `${token[0] ?? '*'}***${token.at(-1) ?? ''}`;
  const visible = token.length <= 12 ? 2 : 4;
  const prefix = token.slice(0, visible);
  const suffix = token.slice(-visible);
  return `${prefix}...${suffix}`;
}

/**
 * Mask numeric identifiers such as phone numbers to avoid PII in logs.
 */
export function maskNumeric(value: string): string {
  if (!value) return '';
  return value.replace(/\d(?=\d{2,})/g, '*');
}

/**
 * Parse Retry-After header (seconds or HTTP-date) into milliseconds.
 */
export function parseRetryAfter(retryAfter: string | null): number | undefined {
  if (!retryAfter) return undefined;

  const numeric = Number(retryAfter);
  if (!Number.isNaN(numeric)) {
    return Math.max(0, numeric * 1000);
  }

  const dateMs = Date.parse(retryAfter);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return Math.max(0, delta);
  }

  return undefined;
}
