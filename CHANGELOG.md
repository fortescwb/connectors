# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-01-19

### Added

- **core-meta-instagram**: New package with Zod schemas for Meta Instagram webhook payloads
- **core-meta-instagram**: Real webhook fixtures (text message, media message, batch)
- **core-meta-instagram**: `parseInstagramRuntimeRequest()` for batch-safe DM parsing
- **core-meta-instagram**: `sendCommentReplyBatch()` client library (capability remains `planned`/library-only; not wired in app)
- **core-meta-instagram**: Comment reply client with retry/backoff and caller-provided dedupe support (no end-to-end exactly-once; production requires shared dedupe store)
- **apps/instagram**: Real Instagram DM parsing (replaces fake `parseEventEnvelope`)
- **apps/instagram**: `inbound_messages` capability promoted to `active`
- **apps/instagram**: Comprehensive integration tests with real fixtures

### Changed

- **apps/instagram**: Migrated from fake parsing to real `parseInstagramRuntimeRequest()`
- **apps/instagram**: Handler now logs DM metadata (`mid`, `senderId`) instead of generic event

---

## [0.2.0] - 2026-01-18

### Added

- **core-runtime**: Batch processing support with `parseEvents` (preferred over `parseEvent`)
- **core-runtime**: `BatchSummary` with `total`, `processed`, `deduped` (count), `failed`
- **core-runtime**: `BatchItemResult` with per-item status including `deduped` (boolean)
- **core-runtime**: `fullyDeduped` as canonical boolean for "all items deduplicated"
- **core-runtime**: `RedisDedupeStore` for distributed deduplication with fail modes
- **core-runtime**: Security guidelines for logging (no PII/payload exposure)
- **core-meta-whatsapp**: New package with Zod schemas for Meta WhatsApp webhook payloads
- **core-meta-whatsapp**: Real webhook fixtures from WhatsApp Business API
- **apps/whatsapp**: Integration with `core-meta-whatsapp` for real payload parsing
- **apps/calendar**: Scaffold for calendar connector (Google Calendar planned)
- **apps/automation**: Scaffold for automation connector (Zapier/n8n planned)

### Changed

- **core-runtime**: Rate limiter now called once per batch with `cost = events.length`
- **core-runtime**: Sequential processing for deterministic logging (parallelism planned)
- **core-webhooks**: Response field renamed from `deduped` to `fullyDeduped` for consistency
- **docs/architecture.md**: Updated HTTP contract with full batch response shape

### Deprecated

- **core-runtime**: `parseEvent` (single-event) is deprecated; use `parseEvents` (batch)

### Fixed

- **core-runtime**: TypeScript strict mode compatibility with `LoggerContext` branded types

---

## Contract Evolution Notes

### Response Field Naming (v0.x → v1.0)

| Field | Type | Scope | Description |
|-------|------|-------|-------------|
| `fullyDeduped` | boolean | top-level | `true` only when ALL items deduplicated |
| `summary.deduped` | number | summary | Count of deduplicated items |
| `results[].deduped` | boolean | per-item | Individual item dedupe status |

> **Design rationale:** Field names are unambiguous by design. No boolean/number collision.
