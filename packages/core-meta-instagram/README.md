# @connectors/core-meta-instagram

Instagram/Meta webhook parsing and Graph API client library.

## Features

### ✅ Instagram DM Inbound (Active)

- **Parser**: `parseInstagramRuntimeRequest()` - Batch-safe parsing of Instagram webhook payloads
- **Fixtures**: Real webhook examples in `fixtures/`
- **Schema**: Zod validation for Meta Instagram webhook structure
- **Dedupe**: Deterministic dedupe key format: `instagram:{recipientId}:msg:{mid}`
- **Tests**: Unit tests covering single messages, media, batches, and invalid payloads

**Usage:**

```typescript
import { parseInstagramRuntimeRequest } from '@connectors/core-meta-instagram';

const events = parseInstagramRuntimeRequest(runtimeRequest);
// Returns: ParsedEvent<InstagramMessageNormalized>[]
```

**Wiring Status**: Fully integrated in `apps/instagram` with end-to-end tests.

---

### 🚧 Instagram Comment Reply (Library Only)

- **Client**: `sendCommentReplyBatch()` - Send comment replies via Graph API v19.0
- **Retry**: Configurable retry with exponential backoff (default: 3 attempts, 200ms base)
- **Dedupe**: Caller-provided dedupe store and mandatory `idempotencyKey`; dedupe check happens before any HTTP call
- **Error Classification**: `client_error`, `retry_exhausted`, `timeout`, `network_error`
- **Tests**: Unit tests for success, dedupe, retry, and timeout scenarios

**Usage:**

```typescript
import { sendCommentReplyBatch } from '@connectors/core-meta-instagram';

// Caller MUST provide a dedupeStore (runtime-managed) and an idempotencyKey per command.
// InMemoryDedupeStore is dev/single-process only.
const results = await sendCommentReplyBatch(
  [
    {
      externalCommentId: 'comment_123',
      externalPostId: 'post_456',
      platform: 'instagram',
      content: { type: 'text', text: 'Thanks for your comment!' },
      tenantId: 'tenant_1',
      idempotencyKey: 'reply_cmd_789' // REQUIRED: stable command ID (e.g., UUID/ULID from caller)
    }
  ],
  {
    accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
    dedupeStore,
    retry: { attempts: 3, backoffMs: 200 }
  }
);
```

### Outbound Dedupe & fullyDeduped Semantics

- `dedupeStore` is **required**; the client will throw if it is omitted to avoid unsafe side-effects.
- `InMemoryDedupeStore` is acceptable for local development or single-process tests only.
- Production usage must wire a shared store (e.g., Redis) so dedupe survives retries, crashes, and multiple instances.
- The client alone does **not** guarantee exactly-once; that property comes from `core-runtime` + a shared `dedupeStore`.
- `fullyDeduped` is computed by the runtime using the provided store; the client simply respects the dedupe decision before sending.
- No implicit DedupeStore is created inside the client—callers must inject a real store from the runtime/app layer.
- `idempotencyKey` is REQUIRED per command; there is no fallback (content hashes/timestamps are rejected). Generate a stable command ID in the caller (e.g., UUID/ULID) and pass it through.

**⚠️ IMPORTANT - Idempotency Key (Required):**

- ❌ Without `idempotencyKey`, the client will throw to avoid unstable dedupe keys.
- ✅ With `idempotencyKey`: dedupe is based on a caller-stable command ID combined with the target comment and tenant context.

**Wiring Status**: **NOT yet integrated** in `apps/instagram`. The library code exists and is tested, but:

- ❌ No capability handler registered in the app
- ❌ No end-to-end integration test
- ❌ Capability status in manifest: `planned` (not `active`)

To promote to `active`, implement:

1. Handler registration in `apps/instagram/src/app.ts`
2. Integration test with real fixtures
3. Command ID generation strategy for `idempotencyKey`

---

## Fixtures

Real webhook payloads (sanitized) are available in `fixtures/`:

- `message_text.json` - Single text DM
- `message_media.json` - Single media DM (image attachment)
- `batch_mixed.json` - Batch with 2 messages (text + media)

---

## Dependencies

- `@connectors/core-runtime` - Runtime types and interfaces
- `@connectors/core-validation` - Zod validation utilities
- `@connectors/core-logging` - Structured logging
- `@connectors/core-comments` - Comment reply command schemas
- `zod` - Schema validation

---

## Development

```bash
pnpm build   # Compile TypeScript
pnpm test    # Run unit tests
pnpm lint    # ESLint
pnpm format  # Prettier
```

---

## Status Summary

| Feature | Status | Wired in App | Tests |
|---------|--------|--------------|-------|
| Instagram DM Inbound | ✅ Active | ✅ Yes | ✅ 4 unit + 17 integration |
| Comment Reply Client | 🚧 Library Only | ❌ No | ✅ 4 unit |

---

## References

- [Meta Instagram Messaging API](https://developers.facebook.com/docs/messenger-platform/instagram)
- [Meta Graph API v19.0](https://developers.facebook.com/docs/graph-api)
