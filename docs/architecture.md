# Conectores: arquitetura e convenções

## Monorepo
- Workspaces pnpm: `apps/*` (deployáveis isoladamente) e `packages/*` (código compartilhado).
- Apps não podem importar código de outras apps. Toda colaboração deve passar por `packages/*`.
- Configurações compartilhadas ficam em `tooling/` (eslint, prettier, vitest).

## Envelope de eventos
Campos obrigatórios em todos os eventos (`EventEnvelope`):
- `eventId`: UUID gerado no conector.
- `eventType`: discriminador (`ConversationMessageReceived`, `ConversationMessageStatusUpdated`, `LeadCaptured`, `ConversationStateChanged`, `ChannelHealthStatusChanged`).
- `occurredAt`: ISO-8601.
- `tenantId`: `TenantId` branded; valide com `assertTenantId`.
- `source`: origem no conector (ex: `whatsapp-webhook`).
- `correlationId` / `causationId`: usados para rastreamento de chamadas upstream.
- `dedupeKey`: obrigatório para idempotência.
- `payload`: corpo específico do evento (schemas Zod definidos em `core-events`).
- `meta`: metadados livres (opcional).

### Eventos disponíveis
- `ConversationMessageReceived`: conteúdo recebido/enviado, direção inbound/outbound, IDs externos e de conversa.
- `ConversationMessageStatusUpdated`: status de mensagem (`sent`, `delivered`, `read`, `failed`), detalhes de provedor.
- `LeadCaptured`: lead com contato e contexto de origem (campanha/medium/referrer).
- `ConversationStateChanged`: transições (`open`, `pending`, `closed`, `snoozed`), ator (`system`/`user`).
- `ChannelHealthStatusChanged`: health (`healthy`, `degraded`, `down`) por canal/região.

### Idempotência
- `dedupeKey` é obrigatório em todos os envelopes.
- Helper `buildDedupeKey(channel, externalId)` centraliza a convenção: `${channel}:${externalId}` (canal em minúsculas).
- Factories em `core-events` preenchem `dedupeKey` automaticamente quando o payload tiver IDs externos adequados.

### Validação
- Schemas Zod em `core-events` são expostos junto com tipos inferidos.
- `parseEventEnvelope` retorna um discriminated union por `eventType`.
- Use `safeParseOrThrow(schema, data, context)` (`core-validation`) para erros claros e tipados (`ValidationError`).
- Webhooks: `core-webhooks` processa requests de forma agnóstica e aplica dedupe (`dedupeKey` com TTL configurável); `adapter-express` adapta para Express.

### Multi-tenant
- `TenantId` é um tipo branded (`@connectors/core-tenant`).
- Valide entradas externas com `assertTenantId` antes de processar rotas ou enfileirar eventos.

### Logging
- `createLogger` (`core-logging`) grava JSON estruturado em stdout/stderr.
- Inclua sempre que possível: `tenantId`, `correlationId`, `eventId`, `eventType`, `dedupeKey`.

### Importação e publicação
- Pacotes em `packages/*` não podem depender de apps.
- Apps só consomem `packages/*`. Reexporte contratos em pacotes compartilhados para uso por todos os conectores.

---

## Contrato do Conector WhatsApp

### Headers aceitos/emitidos

| Header | Direção | Descrição |
|--------|---------|-----------|
| `x-correlation-id` | Request/Response | ID de correlação para rastreamento. **POST**: ver [Precedência do correlationId](#precedência-do-correlationid). **GET**: sempre gera um novo (não preserva header de entrada). Sempre presente na resposta (sucesso e erro). |
| `x-hub-signature-256` | Request | Assinatura HMAC-SHA256 do Meta para validação do webhook (formato: `sha256=<hex>`). |
| `Content-Type` | Request/Response | `application/json` para POST; `text/plain` para GET verify. |

### Endpoints

#### `GET /webhook` — Verificação Meta

Usado pelo Meta para verificar ownership do endpoint.

**Query params:**
- `hub.mode`: deve ser `subscribe`
- `hub.verify_token`: deve corresponder a `WHATSAPP_VERIFY_TOKEN`
- `hub.challenge`: string de challenge retornada em caso de sucesso

**Respostas:**

| Status | Condição | Corpo |
|--------|----------|-------|
| `200` | Verificação bem-sucedida | `<challenge>` (text/plain) |
| `403` | `hub.mode` diferente de `subscribe` | `{ ok: false, code: "FORBIDDEN", message: "Invalid hub.mode", correlationId }` |
| `403` | `hub.verify_token` não corresponde | `{ ok: false, code: "FORBIDDEN", message: "Invalid verify token", correlationId }` |
| `503` | `WHATSAPP_VERIFY_TOKEN` não configurado | `{ ok: false, code: "SERVICE_UNAVAILABLE", message: "Webhook verification not configured", correlationId }` |

#### `POST /webhook` — Recebimento de eventos

Endpoint principal para receber webhooks do Meta/WhatsApp.

**Respostas:**

| Status | Condição | Corpo |
|--------|----------|-------|
| `200` | Evento processado (novo) | `{ ok: true, deduped: false, correlationId }` |
| `200` | Evento duplicado (já visto) | `{ ok: true, deduped: true, correlationId }` |
| `400` | Payload inválido (validação Zod falhou) | `{ ok: false, code: "WEBHOOK_VALIDATION_FAILED", message: "...", correlationId }` |
| `401` | Assinatura inválida (middleware WhatsApp) | `{ ok: false, code: "UNAUTHORIZED", message: "Invalid signature", correlationId }` |
| `401` | Handler interno sinaliza 401 (core-webhooks) | `{ ok: false, code: "UNAUTHORIZED", message: "unauthorized", correlationId }` |
| `500` | Erro interno não esperado | `{ ok: false, code: "INTERNAL_ERROR", message: "internal_error", correlationId }` |

> **Nota:** Em qualquer status (sucesso ou erro), o header `x-correlation-id` é retornado e espelha o `correlationId` do corpo.

### Política de Assinatura

- **Variável de ambiente:** `WHATSAPP_WEBHOOK_SECRET`
- **Comportamento quando configurado:**
  - Header `x-hub-signature-256` é obrigatório
  - Assinatura HMAC-SHA256 é validada usando comparação timing-safe (`crypto.timingSafeEqual`)
  - Requisições com assinatura inválida ou ausente retornam `401`
- **Comportamento quando não configurado:**
  - Validação de assinatura é ignorada (skip)
  - Log de info é emitido: `"Signature validation skipped"`
  - Útil para desenvolvimento local

### Política de Deduplicação

- **Implementação (core-webhooks):**
  - `DedupeStore`: interface para checar e marcar chaves como “vistas”
  - `InMemoryDedupeStore`: store em memória com TTL (padrão quando `dedupeStore` não é fornecido)
  - `NoopDedupeStore`: nunca deduplica (útil quando a idempotência é tratada fora)

- **Configuração:**
  - `createWebhookProcessor({ dedupeStore?, dedupeTtlMs? })`
  - Se `dedupeStore` não for fornecido, usa `InMemoryDedupeStore(dedupeTtlMs ?? 5min)`

- **Chave de dedupe:**
  - A chave utilizada é `event.dedupeKey` (vem do `EventEnvelope` parseado em `parseEvent`).

- **Comportamento em duplicata:**
  - Se `deduped === true`, retorna `200` com `{ ok: true, deduped: true, correlationId }` e não reprocessa o evento.
  - Se não for duplicado, processa e retorna `200` com `{ ok: true, deduped: false, correlationId }`.

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `PORT` | Não | Porta do servidor (default: `3000`) |
| `WHATSAPP_VERIFY_TOKEN` | Sim* | Token para verificação do webhook Meta. *Obrigatório para `GET /webhook` funcionar. |
| `WHATSAPP_WEBHOOK_SECRET` | Não | Secret para validação HMAC-SHA256. Se não definido, validação é ignorada. |

### Precedência do correlationId

**POST /webhook:**

O `correlationId` é determinado pela seguinte ordem de precedência:

1. `event.correlationId` — se presente no `EventEnvelope` parseado
2. Header `x-correlation-id` — se enviado na requisição
3. Gerado automaticamente — formato `{timestamp_base36}-{random_base36}` (ex: `mkii15va-045ggowpt`)

O valor final é retornado tanto no corpo (`correlationId`) quanto no header de resposta (`x-correlation-id`).

**GET /webhook:**

Sempre gera um novo `correlationId` (não lê header de entrada nem envelope).

**Consistência:**

Em todas as respostas (sucesso e erro), o mesmo `correlationId` aparece no header `x-correlation-id` e no corpo JSON.
