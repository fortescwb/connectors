# @connectors/core-meta-instagram

Instagram/Meta webhook parsing and Graph API client library.

## Features

Public API (inbound): use `parseInstagramRuntimeRequest()`; `parseInstagramWebhookPayload()` is internal/deprecated and assumes a validated payload.

### 🟢 Instagram DM Inbound (active)

- **Parser**: `parseInstagramRuntimeRequest()` - Batch-safe parsing of Instagram webhook payloads
- **Canonical event**: `InstagramInboundMessageEventSchema` (provider + channel + payload discriminated union)
- **Dedupe**: Deterministic dedupe key format: `instagram:{recipientId}:msg:{mid}`
- **Tests**: Unit tests covering single messages, media, batches, and invalid payloads; staging validation executed per runbook (see evidence below)

**Usage:**

```typescript
import { parseInstagramRuntimeRequest } from '@connectors/core-meta-instagram';

const events = parseInstagramRuntimeRequest(runtimeRequest);
// Returns: ParsedEvent<InstagramInboundMessageEvent>[]
```

**Wiring Status**: Wired in `apps/instagram` with E2E tests; staging validated for inbound DM (text, image/audio) with dedupe confirmed. Capability remains inbound-only.

---

### 🚧 Instagram DM Outbound (staging-only)

- **Builders**: `buildInstagramMessagePayload()` (supports text, link, image, video, audio, document)
- **Sender**: `sendInstagramMessage()` and `processInstagramOutbound()` (exactly-once via `core-runtime`)
- **Media**: Prefers `attachment_id` upload when `mediaId` is missing (URL-based upload helper included)
- **Staging**: `/__staging/outbound` wired in `apps/instagram` (token-protected)
- **Status**: Planned/beta — waiting on real Graph fixtures to promote capability to `active`
- **Runbook**: `apps/instagram/OUTBOUND_STAGING_RUNBOOK.md` (DM texto: intent, dedupeKey, evidências)

---

### 🚧 Instagram Comment Reply (Library Only)

- **Client**: `sendCommentReplyBatch()` - Send comment replies via Graph API v19.0
- **Graph base**: Reuses `@connectors/core-meta-graph` for headers/auth, retry/backoff (429/5xx/is_transient), and error normalization (`MetaGraphError`)
- **Retry**: Configurable retry with exponential backoff (default: 3 attempts, 200ms base)
- **Dedupe**: Caller-provided dedupe store; dedupe key is anchored on `pageId + externalCommentId` (idempotencyKey is still mandatory but no longer the dedupe discriminator)
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
      pageId: 'page_789',
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
- Dedupe keys are built as `instagram:tenant:{tenantId}:page:{pageId}:comment:{externalCommentId}:reply`, so reprocessing the same comment on the same page is skipped even if the upstream idempotencyKey changes. The idempotencyKey is forwarded as an `Idempotency-Key` header on every retry for provider-side safety.

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

## Staging Validation (Gate T3.2 → Promo Gate T3.3)

- Runbook executado: `apps/instagram/STAGING_RUNBOOK.md`.
- Evidências (staging, 2026-01-23; sanitized):
  - Scenario 1 (DM text): correlationId `ig-stg-text-20260123-01`, summary `{total:1, processed:1, deduped:0}`.
  - Scenario 2 (DM image): correlationId `ig-stg-media-20260123-02`, summary `{total:1, processed:1, deduped:0}`, payload type `image`.
  - Scenario 3 (batch 2 msgs): correlationId `ig-stg-batch-20260123-03`, summary `{total:2, processed:2, deduped:0}`.
  - Scenario 4 (replay dedupe): correlationId `ig-stg-replay-20260123-04`, summary `{total:1, processed:0, deduped:1, fullyDeduped:true}`.
  - Scenario 5 (invalid signature): correlationId `ig-stg-sig-20260123-05`, status `401`, code `UNAUTHORIZED`.
- Logs reviewed via correlationId filters; no PII/payload observed.
- Dedupe confirmed in staging with Redis; signature/verify validated.

### Rollback (if staging regression occurs)
1. Revert `inbound_messages` status in `apps/instagram/src/manifest.ts` to `scaffold`.
2. Remove/annotate evidence block above if invalidated.
3. Deploy rollback; keep runbook for re-validation.

---

## Fixtures

Real webhook payloads (sanitized) are available in `fixtures/`:

- `inbound/text.json` - Single text DM
- `inbound/media.json` - Single media DM (image)
- `inbound/batch.json` - Batch with 2 messages (text + media)
- `inbound/invalid_missing_mid.json` - Batch containing an invalid item (used to assert batch resilience)

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
| Instagram DM Inbound | 🚧 Scaffold | ✅ Yes (local only) | ✅ unit + app tests (no staging validation) |
| DM Outbound (text/link/media) | 🚧 Staging-only | ⚠️ Staging endpoint wired, awaiting fixtures | ✅ unit (payload + send) |
| Comment Reply Client | 🚧 Library Only | ❌ No | ✅ unit + integration (dedupe/idempotency) |

---

## References

- [Meta Instagram Messaging API](https://developers.facebook.com/docs/messenger-platform/instagram)
- [Meta Graph API v19.0](https://developers.facebook.com/docs/graph-api)
