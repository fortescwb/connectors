# WhatsApp Outbound Fixtures Capture Guide

## Overview

This guide explains how to capture **real, sanitized** WhatsApp Graph API request/response payloads in staging and convert them into test fixtures.

> **Important:** Fixtures are used for unit tests and integration tests. Real fixtures are critical to ensure that builders correctly generate Graph-compatible payloads.

## Why Real Fixtures?

- **Builder validation**: Unit tests verify that builders generate exactly the payload that Graph expects
- **Integration coverage**: Integration tests use real fixtures to simulate end-to-end flows
- **Regression detection**: When API contracts change, fixture-based tests fail early
- **Scaffold to Real**: Transitioning from `example_*` to `real_*` fixtures marks a capability as "REAL" (not scaffold)

## Prerequisites

1. **Staging environment** running with WhatsApp integration configured
2. **STAGING_OUTBOUND_TOKEN** environment variable set
3. **Valid WhatsApp template, media, or contact data** in your WABA

## Procedure: Capturing a Fixture

### Step 1: Prepare Your Staging Environment

Ensure the WhatsApp app is running in staging:

```bash
cd apps/whatsapp
REDIS_URL="..." WHATSAPP_ACCESS_TOKEN="..." WHATSAPP_PHONE_NUMBER_ID="..." pnpm dev
```

Verify the staging endpoint is reachable:

```bash
curl http://localhost:3000/health
# Response: { "status": "ok", "connector": "whatsapp" }
```

### Step 2: Use the Staging Outbound Endpoint

The `/__staging/outbound` endpoint accepts intent batches and returns sanitized request/response data:

#### Text Message (Simple)

```bash
curl -X POST http://localhost:3000/__staging/outbound \
  -H "Content-Type: application/json" \
  -H "X-Staging-Token: $(echo $STAGING_OUTBOUND_TOKEN)" \
  -d '{
    "intents": [{
      "intentId": "01H5EXAMPLE-TEXT-INTENT-0001",
      "tenantId": "tenant_test_001",
      "provider": "whatsapp",
      "to": "+5511999999999",
      "payload": {
        "type": "text",
        "text": "Hello from fixture capture"
      },
      "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5EXAMPLE-TEXT-INTENT-0001",
      "correlationId": "corr_text_001",
      "createdAt": "2024-01-15T10:30:00.000Z"
    }]
  }'
```

Response:
```json
{
  "ok": true,
  "result": {
    "summary": { "total": 1, "sent": 1, "deduped": 0, "failed": 0 },
    "items": [
      {
        "status": "sent",
        "providerMessageId": "wamid.HBgLMTU1NTEyMzQ1NjcVAgAR...",
        "request": {
          "messaging_product": "whatsapp",
          "to": "+5511999999999",
          "type": "text",
          "text": { "body": "Hello from fixture capture" },
          "client_msg_id": "01H5EXAMPLE-TEXT-INTENT-0001"
        },
        "response": {
          "messaging_product": "whatsapp",
          "contacts": [{ "input": "+5511999999999", "wa_id": "551199999999" }],
          "messages": [{ "id": "wamid.HBgLMTU1NTEyMzQ1NjcVAgAR..." }]
        }
      }
    ]
  }
}
```

#### Audio Message (via mediaId)

```bash
curl -X POST http://localhost:3000/__staging/outbound \
  -H "Content-Type: application/json" \
  -H "X-Staging-Token: $(echo $STAGING_OUTBOUND_TOKEN)" \
  -d '{
    "intents": [{
      "intentId": "01H5EXAMPLE-AUDIO-INTENT-1234567",
      "tenantId": "tenant_test_001",
      "provider": "whatsapp",
      "to": "+5511999999999",
      "payload": {
        "type": "audio",
        "mediaId": "1234567890123456"
      },
      "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5EXAMPLE-AUDIO-INTENT-1234567",
      "correlationId": "corr_audio_001",
      "createdAt": "2024-01-15T10:31:00.000Z"
    }]
  }'
```

#### Template Message (with Components)

```bash
curl -X POST http://localhost:3000/__staging/outbound \
  -H "Content-Type: application/json" \
  -H "X-Staging-Token: $(echo $STAGING_OUTBOUND_TOKEN)" \
  -d '{
    "intents": [{
      "intentId": "01H5EXAMPLE-TEMPL-INTENT-12345",
      "tenantId": "tenant_test_001",
      "provider": "whatsapp",
      "to": "+5511999999999",
      "payload": {
        "type": "template",
        "templateName": "order_confirmation",
        "languageCode": "pt_BR",
        "components": [
          {
            "type": "body",
            "parameters": [
              { "type": "text", "text": "ORDER-12345" },
              { "type": "text", "text": "2024-01-15" }
            ]
          }
        ]
      },
      "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5EXAMPLE-TEMPL-INTENT-12345",
      "correlationId": "corr_template_001",
      "createdAt": "2024-01-15T10:35:00.000Z"
    }]
  }'
```

#### Reaction Message (to Existing Message)

```bash
curl -X POST http://localhost:3000/__staging/outbound \
  -H "Content-Type: application/json" \
  -H "X-Staging-Token: $(echo $STAGING_OUTBOUND_TOKEN)" \
  -d '{
    "intents": [{
      "intentId": "01H5EXAMPLE-REACT-INTENT-12345",
      "tenantId": "tenant_test_001",
      "provider": "whatsapp",
      "to": "+5511999999999",
      "payload": {
        "type": "reaction",
        "messageId": "wamid.HBgLMTU1NTEyMzQ1NjcVAgAR...",
        "emoji": "👍"
      },
      "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5EXAMPLE-REACT-INTENT-12345",
      "correlationId": "corr_reaction_001",
      "createdAt": "2024-01-15T10:38:00.000Z"
    }]
  }'
```

#### Document Message (with filename/caption)

```bash
curl -X POST http://localhost:3000/__staging/outbound \
  -H "Content-Type: application/json" \
  -H "X-Staging-Token: $(echo $STAGING_OUTBOUND_TOKEN)" \
  -d '{
    "intents": [{
      "intentId": "01H5EXAMPLE-DOC-INTENT-12345678",
      "tenantId": "tenant_test_001",
      "provider": "whatsapp",
      "to": "+5511999999999",
      "payload": {
        "type": "document",
        "mediaUrl": "https://example.com/files/invoice.pdf",
        "filename": "invoice_jan_2024.pdf",
        "caption": "Your invoice for January"
      },
      "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5EXAMPLE-DOC-INTENT-12345678",
      "correlationId": "corr_doc_001",
      "createdAt": "2024-01-15T10:32:00.000Z"
    }]
  }'
```

#### Contacts Message (with Phone + Email)

```bash
curl -X POST http://localhost:3000/__staging/outbound \
  -H "Content-Type: application/json" \
  -H "X-Staging-Token: $(echo $STAGING_OUTBOUND_TOKEN)" \
  -d '{
    "intents": [{
      "intentId": "01H5EXAMPLE-CONTACTS-INT-123456",
      "tenantId": "tenant_test_001",
      "provider": "whatsapp",
      "to": "+5511999999999",
      "payload": {
        "type": "contacts",
        "contacts": [
          {
            "name": {
              "formatted_name": "John Doe",
              "first_name": "John",
              "last_name": "Doe"
            },
            "phones": [
              { "phone": "+15551234567", "type": "CELL" }
            ],
            "emails": [
              { "email": "john@example.com", "type": "WORK" }
            ]
          }
        ]
      },
      "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5EXAMPLE-CONTACTS-INT-123456",
      "correlationId": "corr_contacts_001",
      "createdAt": "2024-01-15T10:33:00.000Z"
    }]
  }'
```

### Step 3: Sanitize and Save the Response

Extract the `request` and `response` from the result and create a sanitized fixture file:

**File:** `packages/core-meta-whatsapp/fixtures/outbound/real/template.json`

```json
{
  "$schema": "../../src/schemas/outbound-intent.json",
  "$description": "Real template message fixture captured from staging Graph API (sanitized)",
  "$captured": "2024-01-15T10:35:00.000Z",
  "$sanitized": true,
  "intent": {
    "intentId": "01H5EXAMPLE-TEMPL-INTENT-12345",
    "tenantId": "tenant_test_001",
    "provider": "whatsapp",
    "to": "+5511999999999",
    "payload": {
      "type": "template",
      "templateName": "order_confirmation",
      "languageCode": "pt_BR",
      "components": [
        {
          "type": "body",
          "parameters": [
            { "type": "text", "text": "ORDER-12345" },
            { "type": "text", "text": "2024-01-15" }
          ]
        }
      ]
    },
    "dedupeKey": "whatsapp:tenant:tenant_test_001:intent:01H5EXAMPLE-TEMPL-INTENT-12345",
    "correlationId": "corr_template_001",
    "createdAt": "2024-01-15T10:35:00.000Z"
  },
  "expectedApiPayload": {
    "messaging_product": "whatsapp",
    "to": "+5511999999999",
    "type": "template",
    "template": {
      "name": "order_confirmation",
      "language": { "code": "pt_BR" },
      "components": [
        {
          "type": "body",
          "parameters": [
            { "type": "text", "text": "ORDER-12345" },
            { "type": "text", "text": "2024-01-15" }
          ]
        }
      ]
    },
    "client_msg_id": "01H5EXAMPLE-TEMPL-INTENT-12345"
  },
  "expectedResponse": {
    "messaging_product": "whatsapp",
    "contacts": [{ "input": "+5511999999999", "wa_id": "551199999999" }],
    "messages": [{ "id": "wamid.HBgLMTU1NTEyMzQ1NjcVAgARGBI5QUZGQUQ1MTJCMTQ1NjdGNUIA" }]
  }
}
```

### Step 4: Verify the Fixture

Run unit tests to verify the fixture generates the expected API payload:

```bash
cd packages/core-meta-whatsapp
pnpm test -- sendMessage.test.ts
```

All tests should pass with the new fixture.

## Sanitization Rules

When capturing fixtures from staging:

1. **Phone numbers**: Mask to `+5511***4567` (keep area code + last 4 digits)
2. **IDs**: Use synthetic IDs like `wamid.SYNTHETIC.ID.123`
3. **URLs**: Use example URLs like `https://example.com/files/invoice.pdf`
4. **Tokens/Credentials**: Never include access tokens, app secrets, or API keys
5. **PII**: No real names, emails, or addresses (use "John Doe", "john@example.com")

## Fixture Naming Convention

Real fixtures follow this pattern:

```
fixtures/outbound/real/{type}.json
```

Where `{type}` is one of:
- `text.json` — Text messages (basic)
- `audio.json` — Audio messages
- `document.json` — Document messages
- `contacts.json` — Contact sharing
- `reaction.json` — Emoji reactions
- `template.json` — Template messages
- `mark_read.json` — Read receipts

## Testing the Fixtures

After adding real fixtures, run:

```bash
# Unit tests (verify payload building)
pnpm -w test packages/core-meta-whatsapp

# Integration tests (verify end-to-end with Redis)
pnpm -w test packages/core-runtime -- outbound-exactly-once

# Full validation
pnpm -w lint && pnpm -w build && pnpm -w test
```

All tests must pass before promoting fixtures to real status.

## FAQ

**Q: Can I use fixtures from example_* for real/?**
A: No. Real fixtures must be captured from staging Graph API. Examples are placeholders only.

**Q: What if my fixture test fails?**
A: The builder output doesn't match the fixture. Check:
1. Fixture matches Graph API contract (consult Meta docs)
2. Builder logic correctly transforms intent → payload
3. No typos or formatting issues

**Q: How do I capture video or image payloads?**
A: Same process. Media is referenced by `mediaId` (uploaded) or `mediaUrl` (link). The API contract is identical.

**Q: Do I need to capture all locale variations?**
A: No. One fixture per type is sufficient. Different `languageCode` values follow the same builder logic.
