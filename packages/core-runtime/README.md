# @connectors/core-runtime

Unified runtime for connectors that centralizes webhook handling with:

- **CorrelationId management**: Consistent tracking across requests
- **Signature verification**: Pluggable HMAC validation
- **Deduplication**: Idempotent event processing
- **Rate limiting**: Pluggable request throttling
- **Structured logging**: Context-aware logging throughout

## Installation

```bash
pnpm add @connectors/core-runtime
```

## Quick Start

```typescript
import { createConnectorRuntime, type RuntimeConfig } from '@connectors/core-runtime';
import { myManifest } from './manifest.js';

const runtime = createConnectorRuntime({
  manifest: myManifest,
  registry: {
    inbound_messages: async (event, ctx) => {
      ctx.logger.info('Processing message', { event });
      // Handle the message
    }
  },
  parseEvent: (request) => ({
    capabilityId: 'inbound_messages',
    dedupeKey: `my-connector:${request.body.id}`,
    payload: request.body
  }),
  verifyWebhook: (query) => {
    if (query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
      return { success: true, challenge: query['hub.challenge'] };
    }
    return { success: false, errorCode: 'FORBIDDEN', errorMessage: 'Invalid token' };
  }
});

// Use with Express via adapter-express
app.get('/webhook', async (req, res) => {
  const result = await runtime.handlers.handleGet({
    headers: req.headers,
    query: req.query,
    body: req.body
  });
  res.status(result.status).send(result.body);
});

app.post('/webhook', async (req, res) => {
  const result = await runtime.handlers.handlePost({
    headers: req.headers,
    query: req.query,
    body: req.body,
    rawBody: req.rawBody
  });
  res.status(result.status).json(result.body);
});
```

## API

### `createConnectorRuntime(config)`

Creates a runtime instance with GET and POST handlers.

**Config options:**

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `manifest` | `ConnectorManifest` | Yes | Connector metadata and capabilities |
| `registry` | `CapabilityRegistry` | Yes | Map of capability ID → handler function |
| `parseEvent` | `EventParser` | Yes | Parse request into normalized event |
| `verifyWebhook` | `WebhookVerifyHandler` | No | Handle GET verification requests |
| `signatureVerifier` | `SignatureVerifier` | No | Verify request signatures (HMAC) |
| `dedupeStore` | `DedupeStore` | No | Custom dedupe storage (default: in-memory) |
| `dedupeTtlMs` | `number` | No | Dedupe TTL in ms (default: 300000 / 5min) |
| `rateLimiter` | `RateLimiter` | No | Rate limiting implementation |
| `logger` | `Logger` | No | Custom logger instance |

### `buildWebhookHandlers(config)`

Lower-level API that returns just the handlers without wrapping in a runtime object.

## Interfaces

### `DedupeStore`

```typescript
interface DedupeStore {
  checkAndMark(key: string, ttlMs: number): Promise<boolean>;
}
```

Built-in implementations:
- `InMemoryDedupeStore` - In-memory with TTL (default)
- `NoopDedupeStore` - Never deduplicates

### `RateLimiter`

```typescript
interface RateLimiter {
  consume(key: string, cost?: number): Promise<RateLimitResult>;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterMs?: number;
}
```

Built-in implementations:
- `NoopRateLimiter` - Always allows

### `SignatureVerifier`

```typescript
interface SignatureVerifier {
  enabled: boolean;
  verify(request: RuntimeRequest): SignatureResult | Promise<SignatureResult>;
}

interface SignatureResult {
  valid: boolean;
  code?: 'INVALID_SIGNATURE' | 'MISSING_SIGNATURE' | 'MISSING_RAW_BODY';
}
```

## CorrelationId Rules

**GET requests:**
- Always generates a new correlationId (ignores headers)

**POST requests:**
1. Uses `event.correlationId` if present
2. Falls back to `x-correlation-id` header
3. Generates new ID if neither exists

## HTTP Response Codes

| Status | Condition |
|--------|-----------|
| 200 | Success (includes `deduped: true/false`) |
| 400 | Event parsing failed |
| 401 | Signature verification failed |
| 403 | Webhook verification failed |
| 429 | Rate limit exceeded |
| 500 | Internal error |
| 503 | Webhook verification not configured |

## Response Format

**Success:**
```json
{ "ok": true, "deduped": false, "correlationId": "mkiquc-abc123" }
```

**Error:**
```json
{ "ok": false, "code": "UNAUTHORIZED", "message": "Invalid signature", "correlationId": "mkiquc-abc123" }
```

All responses include `x-correlation-id` header.
