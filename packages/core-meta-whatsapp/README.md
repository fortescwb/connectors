# @connectors/core-meta-whatsapp

Parser and schemas for Meta WhatsApp Business API webhook payloads.

## Purpose

This package encapsulates all Meta-specific WhatsApp payload handling:
- Zod schemas for webhook validation
- Payload normalization (snake_case → camelCase)
- Dedupe key generation
- PII-safe event extraction

**Design principle:** No WhatsApp/Meta-specific code should exist in `core-runtime` or apps. All Meta logic is contained here.

### Shared Meta Graph base
- Outbound `sendMessage` uses `@connectors/core-meta-graph` (auth headers, versioning, retry/backoff, rate-limit/429 handling, error classes).
- Observability is centralized in the Graph client: structured logs only with metadata (`endpoint`, `status`, `latencyMs`, `fbtraceId`), never payloads/PII.
- Channel-specific parsing/schema stays here; only the HTTP/Graph layer is shared across Meta connectors.

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

## Fixtures

Real webhook payloads (with PII redacted) are stored in `fixtures/`:

| File | Description | Capabilities |
|------|-------------|--------------|
| `message_batch.json` | Text + image messages with delivered status | `inbound_messages`, `message_status_updates` |
| `message_duplicate.json` | Duplicate message for dedupe testing | `inbound_messages` |
| `status_sent.json` | Status update: sent | `message_status_updates` |
| `status_read.json` | Status update: read | `message_status_updates` |
| `status_failed.json` | Status update: failed with error | `message_status_updates` |
| `invalid_missing_metadata.json` | Invalid payload (validation error) | - |

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
