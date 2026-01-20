# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> Releases are **independent per package**. Package versions below are authoritative; there is no single monorepo version.

## 2026-01-19 — Package releases (Meta Graph base)

### @connectors/core-meta-graph @0.1.0
- Shared Meta Graph client with auth/versioning defaults, retry/backoff (429 + `Retry-After`, 5xx, `is_transient`), and error normalization via `MetaGraphError` classes.
- Helpers for `buildGraphUrl`, `classifyError`, `parseRetryAfter`, and PII-safe masking/logging.

### @connectors/core-meta-whatsapp @0.2.0
- `sendMessage` now uses the shared Meta Graph client (headers/auth, retry/backoff, rate-limit handling) instead of a bespoke fetch wrapper.
- Tests cover rate-limit/timeout scenarios; internal deps normalized to `workspace:^`.

### @connectors/core-meta-instagram @0.3.0
- Comment reply client refactored to reuse the shared Meta Graph base for HTTP/retry/error normalization.
- Maintains dedupe/idempotency guarantees; retry/backoff honors Meta rate-limit signals.

### @connectors/core-meta-messenger @0.1.0
- Scaffold package with Messenger Graph client wrapper on top of the shared base.
- Webhook parsing remains TODO with explicit placeholder (no capabilities marked active).

## 2026-01-19 — Package releases

### @connectors/core-meta-instagram @0.2.0
- New package with Zod schemas for Meta Instagram webhook payloads
- Real webhook fixtures (text message, media message, batch)
- `parseInstagramRuntimeRequest()` for batch-safe DM parsing
- `sendCommentReplyBatch()` client library (capability remains `planned`/library-only; not wired in app)
- Comment reply client with retry/backoff and caller-provided dedupe support (no end-to-end exactly-once; production requires shared dedupe store)

### @connectors/instagram-app @0.2.0
- Real Instagram DM parsing (replaces fake `parseEventEnvelope`)
- `inbound_messages` capability wired and tested with real fixtures; `comment_reply` remains planned (library only, not wired)
- Handler now logs DM metadata (`mid`, `senderId`) instead of generic event

## 2026-01-18 — Package releases

### @connectors/core-runtime @0.2.0
- Batch processing support with `parseEvents` (preferred over `parseEvent`)
- `BatchSummary` with `total`, `processed`, `deduped` (count), `failed`
- `BatchItemResult` with per-item status including `deduped` (boolean)
- `fullyDeduped` as canonical boolean for "all items deduplicated"
- `RedisDedupeStore` for distributed deduplication with fail modes
- Security guidelines for logging (no PII/payload exposure)
- Rate limiter now called once per batch with `cost = events.length`
- Sequential processing for deterministic logging (parallelism planned)
- Response field renamed from `deduped` to `fullyDeduped` for consistency
- HTTP contract updated with full batch response shape

### @connectors/core-meta-whatsapp @0.1.0
- New package with Zod schemas for Meta WhatsApp webhook payloads
- Real webhook fixtures from WhatsApp Business API

### Apps scaffolds @0.1.0
- `apps/whatsapp`: Integration with `core-meta-whatsapp` for real payload parsing
- `apps/calendar`: Scaffold for calendar connector (Google Calendar planned)
- `apps/automation`: Scaffold for automation connector (Zapier/n8n planned)

---

## Contract Evolution Notes

### Response Field Naming (v0.x → v1.0)

| Field | Type | Scope | Description |
|-------|------|-------|-------------|
| `fullyDeduped` | boolean | top-level | `true` only when ALL items deduplicated |
| `summary.deduped` | number | summary | Count of deduplicated items |
| `results[].deduped` | boolean | per-item | Individual item dedupe status |

> **Design rationale:** Field names are unambiguous by design. No boolean/number collision.
