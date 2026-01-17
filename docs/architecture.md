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
