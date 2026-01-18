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
  parseEvents: (request) => [
    {
      capabilityId: 'inbound_messages',
      dedupeKey: `my-connector:${request.body.id}`,
      payload: request.body
    }
  ],
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
| `parseEvents` | `EventBatchParser` | Preferred | Parse request into a batch of normalized events (processed item-by-item) |
| `parseEvent` | `EventParser` | Compat | Legacy single-event parser (wrapped into a batch automatically) |
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
- `InMemoryDedupeStore` - In-memory with TTL (default, single-instance only)
- `NoopDedupeStore` - Never deduplicates
- `RedisDedupeStore` - Redis-based for distributed environments

#### Redis DedupeStore (Distributed)

For multi-instance deployments, use `RedisDedupeStore`:

```typescript
import Redis from 'ioredis';
import { createConnectorRuntime, createRedisDedupeStore } from '@connectors/core-runtime';

const redis = new Redis(process.env.REDIS_URL);

const dedupeStore = createRedisDedupeStore({
  client: redis,
  keyPrefix: 'myapp:dedupe:',  // Optional, default: 'dedupe:'
  failMode: 'open',            // 'open' = block on error, 'closed' = allow on error
  onError: (err, ctx) => {
    console.error('Redis dedupe error', { error: err.message, ...ctx });
  }
});

const runtime = createConnectorRuntime({
  // ...
  dedupeStore,
});
```

**Fail modes:**
- `open` (default): On Redis error, treat as duplicate → blocks processing (safer, no duplicates)
- `closed`: On Redis error, treat as new → allows processing (may cause duplicates)

**Redis client interface:**
```typescript
interface RedisClient {
  set(key: string, value: string, mode: 'NX', flag: 'PX', ttlMs: number): Promise<string | null>;
  exists(key: string): Promise<number>;
}
```

Compatible with `ioredis`, `redis` (node-redis v4+), and similar clients.

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
| 200 | Success (includes `summary` + `fullyDeduped`) |
| 400 | Event parsing failed |
| 401 | Signature verification failed |
| 403 | Webhook verification failed |
| 429 | Rate limit exceeded |
| 500 | Internal error |
| 503 | Webhook verification not configured |

## Response Format

**Success:**
```json
{
  "ok": true,
  "fullyDeduped": false,
  "correlationId": "mkiquc-abc123",
  "summary": { "total": 3, "processed": 3, "deduped": 0, "failed": 0 },
  "results": [
    { "capabilityId": "inbound_messages", "dedupeKey": "k1", "ok": true, "deduped": false, "correlationId": "mkiquc-abc123" }
  ]
}
```

**Response fields:**
- `fullyDeduped` (boolean): `true` only when ALL items in the batch were deduplicated (no processing, no failures)
- `summary.deduped` (number): Count of deduplicated items
- `results[].deduped` (boolean): Per-item dedupe status
- `results[].errorCode` (string): Error code when `ok: false` (`NO_HANDLER`, `HANDLER_FAILED`)

> **Note:** Field names are unambiguous by design. `fullyDeduped` is always boolean (batch-level), `summary.deduped` is always number (count).

**Error:**
```json
{ "ok": false, "code": "UNAUTHORIZED", "message": "Invalid signature", "correlationId": "mkiquc-abc123" }
```

All responses include `x-correlation-id` header.

## Security Guidelines

### Logging & PII

The runtime logs **only metadata**, never raw payloads:

| Logged | NOT Logged |
|--------|------------|
| `correlationId` | `request.body` |
| `capabilityId` | `event.payload` |
| `dedupeKey` | Message content |
| `outcome` | User data |
| `latencyMs` | Phone numbers |
| `errorCode` | Names, emails |

**Handler responsibility:** When implementing handlers, **do not log `event.payload` directly**. Instead:

```typescript
// ❌ BAD - exposes PII
ctx.logger.info('Processing message', { payload: event.payload });

// ✅ GOOD - log only non-sensitive metadata
ctx.logger.info('Processing message', { 
  messageId: event.payload.id,
  messageType: event.payload.type,
  hasMedia: !!event.payload.media
});
```

### Rate Limiting Behavior

Rate limiter is called **once per batch** with `cost = events.length`:
- Key: `tenant ?? manifest.id`
- Scope: All events in batch share the same rate limit consumption
- Result: 429 affects entire batch (no partial processing)

## Testing

### Unit Tests

```bash
pnpm test
```

### Integration Tests (Redis)

Integration tests use [testcontainers](https://testcontainers.com/) to spin up a real Redis instance.

**With Docker:**
```bash
pnpm test
```

**With Podman (Parrot OS, Fedora, etc.):**
```bash
# Enable Podman socket
systemctl --user enable --now podman.socket

# Run tests with Podman configuration
DOCKER_HOST="unix://$XDG_RUNTIME_DIR/podman/podman.sock" \
TESTCONTAINERS_RYUK_DISABLED=true \
pnpm test
```

**CI Behavior:**
- When `CI=true`, integration tests **fail** if Redis container cannot start
- Locally, tests are skipped with a warning if container is unavailable

### Outbound exactly-once tests

The outbound pipeline uses Redis for distributed dedupe and is covered by an integration test:

```bash
# Full suite (includes outbound)
pnpm --filter @connectors/core-runtime test

# Focus only on outbound exactly-once
pnpm --filter @connectors/core-runtime test -- --grep "outbound runtime exactly-once"
```

Requirements:
- Docker or Podman available for testcontainers
- Redis image `redis:7-alpine` (override with `REDIS_TEST_IMAGE`)

The test spins two runtime instances sharing Redis and asserts that two intents
with the same `dedupeKey` trigger exactly one provider send while logging
`correlationId` + `dedupeKey` per item.
