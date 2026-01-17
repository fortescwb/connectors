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

> **Duas origens de 401:** A mensagem `"Invalid signature"` indica falha na validação HMAC (middleware de assinatura). A mensagem `"unauthorized"` indica que o handler da aplicação ou `parseEvent` lançou um erro com `status: 401` (tratado pelo core-webhooks). Essa distinção ajuda no diagnóstico.

### Política de Assinatura

- **Variável de ambiente:** `WHATSAPP_WEBHOOK_SECRET`
- **Comportamento quando configurado:**
  - Header `x-hub-signature-256` é obrigatório
  - Assinatura HMAC-SHA256 é validada usando comparação timing-safe (`crypto.timingSafeEqual`)
  - Requisições com assinatura inválida ou ausente retornam `401`
- **Comportamento quando não configurado:**
  - Validação de assinatura é ignorada (skip)
  - Log de info é emitido: `"Signature validation skipped"` com campo `signatureValidation: "skipped"`
  - Útil para desenvolvimento local

> **Importante:** A verificação HMAC exige o corpo bruto (`rawBody`) antes do parse JSON. O middleware `rawBodyMiddleware()` do `adapter-express` captura o Buffer original via `express.json({ verify })`. Isso é essencial porque o Meta assina o corpo literal da requisição.

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

- **Ambientes distribuídos:**
  - `InMemoryDedupeStore` é adequado para instância única ou testes.
  - Para deploy multi-instância (Kubernetes, ECS, etc.), implemente `DedupeStore` com backend persistente (Redis, DynamoDB, PostgreSQL).
  - O TTL deve ser configurado de acordo com a janela de retry do Meta (recomendado: 5-15 minutos).

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

Sempre gera um novo `correlationId` internamente. Mesmo que o cliente envie o header `x-correlation-id`, ele será ignorado — a rota de verificação Meta não preserva correlationId de entrada. Isso simplifica a implementação e evita que um atacante force um ID específico durante a verificação.

**Consistência:**

Em todas as respostas (sucesso e erro), o mesmo `correlationId` aparece no header `x-correlation-id` e no corpo JSON.

---

## Project Standards

Referência rápida de padrões para replicar em novos conectores.

### HTTP Contract

- **Response shape (sucesso):** `{ ok: true, deduped: boolean, correlationId: string }`
- **Response shape (erro):** `{ ok: false, code: string, message: string, correlationId: string }`
- **Códigos de erro padrão:** `WEBHOOK_VALIDATION_FAILED` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `SERVICE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500)
- **Header obrigatório em todas as respostas:** `x-correlation-id`
- **Content-Type:** `application/json` (POST), `text/plain` (GET verify)

### CorrelationId Rules

- **Precedência POST:** `event.correlationId` > header `x-correlation-id` > gerado
- **GET /webhook:** Sempre gera novo (ignora header de entrada)
- **Formato:** `{timestamp_base36}-{random_base36}` (ex: `mkii15va-045ggowpt`)
- **Consistência:** Mesmo valor em header e body em todas as respostas

### Signature Policy

- **Requisito:** `rawBodyMiddleware()` do `adapter-express` deve ser aplicado ANTES de qualquer parse JSON
- **Header:** `x-hub-signature-256` (formato `sha256=<hex>`)
- **Algoritmo:** HMAC-SHA256 com comparação timing-safe (`crypto.timingSafeEqual`)
- **Comportamento:**
  - Secret configurado: validação obrigatória, 401 se inválido/ausente
  - Secret não configurado: skip com log info (`signatureValidation: "skipped"`)
- **Resposta 401:** `{ ok: false, code: "UNAUTHORIZED", message: "Invalid signature", correlationId }`

### Dedupe Policy

- **Interface:** `DedupeStore` com método `isDuplicate(key: string): Promise<boolean>`
- **Stores disponíveis:** `InMemoryDedupeStore` (default), `NoopDedupeStore`
- **TTL default:** 5 minutos (300.000ms)
- **Chave:** `event.dedupeKey` (formato: `{channel}:{externalId}`)
- **Resposta em duplicata:** `{ ok: true, deduped: true, correlationId }` (200, não reprocessa)

### Logging Baseline

- **Formato:** JSON estruturado via `createLogger()` do `core-logging`
- **Campos mínimos:** `service`, `correlationId`, `tenantId`, `eventId`, `eventType`, `dedupeKey`
- **Mensagens padrão:**
  - `"Webhook event processed"` — sucesso
  - `"Duplicate webhook event skipped"` — dedupe
  - `"Signature validation skipped"` — sem secret configurado
  - `"Webhook validation failed"` — 400
  - `"Unauthorized webhook request"` — 401
  - `"Webhook handler failed"` — 500

### Testing Baseline

- **Framework:** Vitest + Supertest
- **Casos mínimos para cada conector:**
  1. Health check (`GET /health` → 200)
  2. Payload válido → 200 com `deduped: false`
  3. Payload duplicado → 200 com `deduped: true`
  4. Payload inválido → 400 com `WEBHOOK_VALIDATION_FAILED`
  5. Assinatura válida (com secret) → 200
  6. Assinatura inválida → 401 com `"Invalid signature"`
  7. Assinatura ausente (com secret) → 401
  8. Sem secret → 200 com log de skip
  9. Verificação Meta válida → 200 text/plain com challenge
  10. Verificação Meta inválida (token) → 403
  11. Verificação Meta inválida (mode) → 403
  12. Verificação Meta sem config → 503
  13. CorrelationId preservado do header
  14. CorrelationId gerado quando ausente
  15. CorrelationId preservado em erros

### Estrutura de Novo Conector

```
apps/{connector}/
├── package.json          # deps: @connectors/adapter-express, core-*
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── app.ts            # buildApp() com middlewares e rotas
│   └── server.ts         # entry point
└── tests/
    └── webhook.test.ts   # casos mínimos acima
```

### Checklist de Novo Conector

- [ ] Criar app em `apps/{connector}/`
- [ ] Configurar `rawBodyMiddleware()` antes de rotas POST
- [ ] Implementar `correlationIdMiddleware()` (pode copiar do WhatsApp)
- [ ] Implementar `signatureValidationMiddleware()` com secret específico
- [ ] Usar `createWebhookProcessor()` com `parseEvent` e `onEvent`
- [ ] Implementar GET verify específico do provedor (se aplicável)
- [ ] Definir variáveis de ambiente: `PORT`, `{CONNECTOR}_VERIFY_TOKEN`, `{CONNECTOR}_WEBHOOK_SECRET`
- [ ] Escrever todos os testes mínimos
- [ ] Documentar endpoints em `docs/architecture.md`
