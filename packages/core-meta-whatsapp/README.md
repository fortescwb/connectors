# @connectors/core-meta-whatsapp

Parser, schemas, and outbound message sender for Meta WhatsApp Business API.

## Principal Functionality Status

> **Status definition:**
> - **✅ Implemented**: Code complete, unit tests passing, fixtures present
> - **🟡 Active (Staging)**: Builders + testes completo, pendente validação com tráfego real em staging
> - **🟢 REAL (Production-Ready)**: Fixtures reais capturados, integração testada, pronto para produção

| Capability | Status | Notes |
|------------|--------|-------|
| **Inbound messages** | ✅ Active | text, image, document, webhook verification, dedupe by wamid |
| **Status updates** | ✅ Active | sent, delivered, read, failed, dedupe by id+status |
| **Outbound: text** | 🟡 Active | builders complete, retry/backoff, preview_url support, fixtures present |
| **Outbound: audio** | 🟡 Active | builders complete, mediaId/mediaUrl support, retry/backoff, fixtures present |
| **Outbound: document** | 🟡 Active | builders complete, filename/caption support, retry/backoff, fixtures present |
| **Outbound: contacts** | 🟡 Active | builders complete, multi-contact vCard support, fixtures present |
| **Outbound: reaction** | 🟡 Active | builders complete, emoji support, fixtures present |
| **Outbound: template** | 🟡 Active | builders complete, components/parameters, retry/backoff, fixtures present |
| **Mark as read** | 🟡 Active | builders complete, read receipts, retry/backoff, fixtures present |
| Template management | 📋 Backlog | CRUD operations for templates |
| Media upload | 📋 Backlog | Upload media to WhatsApp servers |
| Interactive messages | 📋 Backlog | Buttons, lists, product messages |

## Status Transition: Active → REAL

The 7 outbound types (text, audio, document, contacts, reaction, template, mark_read) are currently **🟡 Active** and transition to **🟢 REAL** through staging validation.

### What's complete:
- ✅ Builders (payload generation per type)
- ✅ Retry/backoff with exponential delays
- ✅ Idempotency via `clientMessageId` = `intentId`
- ✅ Dedupe before HTTP (zero side-effect duplication on retry)
- ✅ Example fixtures for all types
- ✅ 34 unit tests covering payload + retry scenarios
- ✅ 12 integration tests with Redis dedupe across concurrent runners

### What's pending (staging validation):
- [ ] **Real fixtures** captured from staging Graph API (sanitized)
- [ ] **End-to-end tráfego real** validation in staging
- [ ] **Observability** spot-check (no PII in logs)
- [ ] **Smoke test** rollback drill

### How to capture real fixtures:

See [FIXTURES_CAPTURE_GUIDE.md](./FIXTURES_CAPTURE_GUIDE.md) for step-by-step procedures.

Quick example (text message):

```bash
curl -X POST http://localhost:3000/__staging/outbound \
  -H "X-Staging-Token: $STAGING_OUTBOUND_TOKEN" \
  -d '{
    "intents": [{
      "intentId": "01H5EXAMPLE-TEXT-001",
      "tenantId": "staging-test",
      "provider": "whatsapp",
      "to": "+5511999999999",
      "payload": { "type": "text", "text": "Olá" },
      "dedupeKey": "whatsapp:tenant:staging-test:intent:01H5EXAMPLE-TEXT-001",
      "correlationId": "corr-1",
      "createdAt": "2024-01-21T10:00:00.000Z"
    }]
  }'
```

After capturing 6 real fixtures and validating staging tests pass, mark as **🟢 REAL** in manifest.

## Purpose

This package encapsulates all Meta-specific WhatsApp payload handling:
- Zod schemas for webhook validation
- Payload normalization (snake_case → camelCase)
- Dedupe key generation
- PII-safe event extraction
- Outbound message builders for all principal message types

**Design principle:** No WhatsApp/Meta-specific code should exist in `core-runtime` or apps. All Meta logic is contained here.

### Shared Meta Graph base
- Outbound `sendMessage` uses `@connectors/core-meta-graph` (auth headers, versioning, retry/backoff, rate-limit/429 handling, error classes).
- Observability is centralized in the Graph client: structured logs only with metadata (`endpoint`, `status`, `latencyMs`, `fbtraceId`), never payloads/PII.
- Channel-specific parsing/schema stays here; only the HTTP/Graph layer is shared across Meta connectors.

### Outbound (Graph + runtime dedupe)
- Build dedupe keys with `buildWhatsAppOutboundDedupeKey(tenantId, intentId)` from `@connectors/core-messaging` to avoid embedding phone numbers in the dedupe store.
- The runtime (`core-runtime/processOutboundBatch`) performs dedupe **before** any HTTP side-effect; the same `intentId` is used as `client_msg_id` in the Graph payload for provider-side idempotency.
- Distributed dedupe (Redis) is covered by integration tests with concurrent runtime instances to ensure only one send occurs per intent, even on retries/timeouts.

## Installation

```bash
pnpm add @connectors/core-meta-whatsapp
```

## Usage

```typescript
import { parseWhatsAppRuntimeRequest } from '@connectors/core-meta-whatsapp';
import { createConnectorRuntime } from '@connectors/core-runtime';

const runtime = createConnectorRuntime({
  // ...
  parseEvents: parseWhatsAppRuntimeRequest
});
```

## Parsed Event Structure

### `inbound_messages` capability

```typescript
interface WhatsAppMessageEventPayload {
  object: string;          // "whatsapp_business_account"
  metadata: {
    displayPhoneNumber: string;
    phoneNumberId: string;
  };
  contacts?: Array<{
    waId: string;
    name?: string;
  }>;
  message: {
    id: string;            // wamid.XXX
    from?: string;         // sender phone number
    timestamp?: string;
    type: string;          // "text", "image", "document", etc.
    textBody?: string;     // for type="text"
    image?: { id?: string; mimeType?: string; sha256?: string; caption?: string };
    document?: { id?: string; mimeType?: string; sha256?: string; filename?: string };
    raw: Record<string, unknown>;  // original payload for edge cases
  };
}
```

### `message_status_updates` capability

```typescript
interface WhatsAppStatusEventPayload {
  object: string;
  metadata: {
    displayPhoneNumber: string;
    phoneNumberId: string;
  };
  status: {
    id?: string;           // wamid.XXX
    status: string;        // "sent", "delivered", "read", "failed"
    timestamp?: string;
    recipientId?: string;
    conversationId?: string;
    raw: Record<string, unknown>;
  };
}
```

## Dedupe Key Format

Dedupe keys are deterministic and include enough context to prevent collisions:

| Event Type | Format | Example |
|------------|--------|---------|
| Message | `whatsapp:{phoneNumberId}:msg:{messageId}` | `whatsapp:441234567890:msg:wamid.MSG1.111111` |
| Status | `whatsapp:{phoneNumberId}:status:{statusId}:{status}` | `whatsapp:441234567890:status:wamid.MSG1.111111:delivered` |

**Why status includes the status name:** A single message can have multiple status updates (sent → delivered → read). Including the status name ensures each update is processed exactly once.

## Outbound Messages

All principal outbound message types are supported via `sendMessage()`:

```typescript
import { sendWhatsAppOutbound } from '@connectors/core-meta-whatsapp';
import { buildWhatsAppOutboundDedupeKey, type OutboundMessageIntent } from '@connectors/core-messaging';

// Text message
const textIntent: OutboundMessageIntent = {
  intentId: '550e8400-e29b-41d4-a716-446655440000',
  tenantId: 'tenant-1',
  provider: 'whatsapp',
  to: '+15551234567',
  payload: { type: 'text', text: 'Hello!', previewUrl: false },
  dedupeKey: buildWhatsAppOutboundDedupeKey('tenant-1', '550e8400-e29b-41d4-a716-446655440000'),
  correlationId: 'corr-123',
  createdAt: new Date().toISOString()
};

const result = await sendWhatsAppOutbound(textIntent, {
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID
});

// Mark message as read with the same dispatcher
await sendWhatsAppOutbound(
  {
    ...textIntent,
    payload: { type: 'mark_read', messageId: 'wamid.XXX' }
  },
  {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID
  }
);
```

### Supported Payload Types

| Type | Fields | Notes |
|------|--------|-------|
| `text` | `text`, `previewUrl?` | Plain text with optional link preview |
| `audio` | `mediaId` or `mediaUrl` | Audio file (ogg, mp3, etc.) |
| `document` | `mediaId` or `mediaUrl`, `filename?`, `caption?` | PDF, DOC, etc. |
| `contacts` | `contacts[]` with `name`, `phones?`, `emails?` | vCard-style sharing |
| `reaction` | `messageId`, `emoji` | React to a message |
| `template` | `templateName`, `languageCode`, `components?` | Pre-approved templates |

## Fixtures

Real webhook payloads (with PII redacted) are stored in `fixtures/`:

### Inbound Fixtures

| File | Description | Capabilities |
|------|-------------|--------------|
| `message_batch.json` | Text + image messages with delivered status | `inbound_messages`, `message_status_updates` |
| `message_duplicate.json` | Duplicate message for dedupe testing | `inbound_messages` |
| `status_sent.json` | Status update: sent | `message_status_updates` |
| `status_read.json` | Status update: read | `message_status_updates` |
| `status_failed.json` | Status update: failed with error | `message_status_updates` |
| `invalid_missing_metadata.json` | Invalid payload (validation error) | - |

### Outbound Fixtures

All outbound fixtures are **scaffold/examples** only. Capture real sandbox traffic before promoting readiness.

| File | Origem | Data | Campos sanitizados / TODOs |
|------|--------|------|----------------------------|
| `outbound/example_text_message.json` | Exemplo scaffold (não capturado de tráfego real) – TODO capturar payload real de sandbox/test | N/A | `to`, `wa_id`, `intentId`, message body, fbtrace IDs sanitizados |
| `outbound/example_audio_message.json` | Exemplo scaffold – TODO substituir por captura real | N/A | `mediaId/mediaUrl`, `to`, `intentId` sanitizados |
| `outbound/example_document_message.json` | Exemplo scaffold – TODO substituir por captura real | N/A | Document link/ID, filename, `to`, `intentId` sanitizados |
| `outbound/example_contacts_message.json` | Exemplo scaffold – TODO substituir por captura real | N/A | Contatos/telefones/emails, `intentId` sanitizados |
| `outbound/example_reaction_message.json` | Exemplo scaffold – TODO substituir por captura real | N/A | `messageId`, `emoji`, `intentId` sanitizados |
| `outbound/example_template_message.json` | Exemplo scaffold – TODO substituir por captura real | N/A | Template name/components, `intentId`, destinatário sanitizados |
| `outbound/example_mark_read.json` | Exemplo scaffold – TODO substituir por captura real | N/A | `message_id`, `intentId`, `to` sanitizados |

### How to capture/update fixtures

1. **Enable webhook logging** in development environment
2. **Capture raw payload** from Meta webhook
3. **Redact PII** before committing:
   - Replace real phone numbers with test numbers (e.g., `15550001234`)
   - Replace real names with "Meta Test User"
   - Replace real media IDs with placeholders
   - Keep structure and field names intact
4. **Validate** fixture parses correctly with existing schemas
5. **Add test** that uses the new fixture

```bash
# Validate a fixture
pnpm test -- --grep "parses fixture_name"
```

### PII Redaction Checklist

| Field | Redact? | Example Safe Value |
|-------|---------|-------------------|
| `display_phone_number` | ✅ Yes | `15550001234` |
| `phone_number_id` | ⚠️ Internal ID, keep fake | `441234567890` |
| `wa_id` | ✅ Yes | `15551234567` |
| `profile.name` | ✅ Yes | `Meta Test User` |
| `from` | ✅ Yes | `15551234567` |
| `recipient_id` | ✅ Yes | `15551234567` |
| `text.body` | ✅ Yes | `Hello from WhatsApp` |
| `image.id` | ⚠️ Media ID, keep fake | `MEDIA_ID_1` |
| `wamid.*` | ⚠️ Internal ID, keep fake | `wamid.MSG1.111111` |

## Meta API Versioning

The Meta WhatsApp Business API evolves over time. This package handles versioning as follows:

### Current Version

- **Tested with:** Meta Graph API v18.0+
- **Webhook format:** Cloud API (not On-Premise)

### Handling Breaking Changes

1. **Schema updates:** Add new optional fields to Zod schemas (backward compatible)
2. **New message types:** Extend `messageSchema` with new fields, add fixtures
3. **Breaking changes:** Create new parser version, deprecate old one

```typescript
// Future version support pattern
import { parseWhatsAppWebhook } from '@connectors/core-meta-whatsapp';        // v18+
import { parseWhatsAppWebhookV17 } from '@connectors/core-meta-whatsapp/v17'; // legacy
```

### Adding Support for New Message Types

1. Add field to `messageSchema` in `src/index.ts`
2. Update `toMessage()` to normalize the field
3. Add fixture with real (redacted) payload
4. Add test case
5. Update this README

## Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test -- --coverage
```

### Test Coverage Requirements

- ✅ Each message type (text, image, document) has fixture + test
- ✅ Each status type (sent, delivered, read, failed) has fixture + test
- ✅ Dedupe keys are deterministic and unique
- ✅ Invalid payloads throw `ValidationError`
- ✅ Empty payloads (no messages/statuses) throw `ValidationError`

## Exports

```typescript
// Main parser
export { parseWhatsAppWebhook, parseWhatsAppRuntimeRequest } from '@connectors/core-meta-whatsapp';

// Outbound
export {
  sendMessage,
  markAsRead,
  type WhatsAppSendMessageConfig,
  type WhatsAppSendMessageResponse,
  type WhatsAppMarkReadConfig,
  type WhatsAppMarkReadResponse
} from '@connectors/core-meta-whatsapp';

// Types
export type {
  WhatsAppContact,
  WhatsAppMessage,
  WhatsAppMessageEventPayload,
  WhatsAppMetadata,
  WhatsAppStatus,
  WhatsAppStatusEventPayload
} from '@connectors/core-meta-whatsapp';
```
