# Conectores: arquitetura e convenções

## Monorepo
- Workspaces pnpm: `apps/*` (deployáveis isoladamente) e `packages/*` (código compartilhado).
- Apps não podem importar código de outras apps. Toda colaboração deve passar por `packages/*`.
- Configurações compartilhadas ficam em `tooling/` (eslint, prettier, vitest).

---

## Integration Contract

O Integration Contract define como conectores interagem com o sistema de forma padronizada.

### Capabilities

Cada conector declara suas capabilities em um `ConnectorManifest`. Capabilities são identificadores padronizados que indicam o que o conector suporta:

| Capability | Descrição |
|------------|-----------|
| `inbound_messages` | Receber mensagens de usuários |
| `outbound_messages` | Enviar mensagens para usuários |
| `message_status_updates` | Receber status de mensagens (sent, delivered, read, failed) |
| `comment_ingest` | Receber comentários em posts/mídias |
| `comment_reply` | Responder a comentários |
| `reaction_ingest` | Receber reações (likes, emojis) |
| `ads_leads_ingest` | Receber leads de Lead Ads |
| `ads_campaign_sync` | Sincronizar campanhas de ads |
| `contact_sync` | Sincronizar contatos |
| `conversation_sync` | Sincronizar conversas históricas |
| `channel_health` | Monitorar saúde do canal |
| `webhook_verification` | Endpoint de verificação do provedor |

Cada capability tem um status:
- **`active`**: Implementado e funcional conforme evidência (fixtures reais + testes + logging por item). Pode ainda depender de store compartilhado para produção.
- **`planned`**: Na roadmap, ainda não implementado ou somente biblioteca não wired no app.
- **`disabled`**: Implementado mas desativado.

> Rubric detalhado de prontidão (planned/scaffold/active/beta/prod) está em `TODO_list.md` (fonte canônica de Sprint-0). `active` ≠ produção sem dedupe store compartilhado.

### Eventos Normalizados

Eventos gerados por conectores usam o `EventEnvelope` padronizado:

| eventType | Pacote de origem | Uso |
|-----------|------------------|-----|
| `ConversationMessageReceived` | `core-events` | Mensagens inbound/outbound |
| `ConversationMessageStatusUpdated` | `core-events` | Status de entrega |
| `LeadCaptured` | `core-events` | Leads de formulários/ads |
| `ConversationStateChanged` | `core-events` | Transições de estado de conversa |
| `ChannelHealthStatusChanged` | `core-events` | Mudanças de health do canal |

Eventos de domínios específicos:
| Contrato | Pacote | Uso |
|----------|--------|-----|
| `AdLead` | `core-ads` | Leads normalizados de Lead Ads |
| `SocialComment` | `core-comments` | Comentários normalizados |

### Comandos Normalizados

Comandos são ações que o sistema envia para conectores executarem:

| Comando | Pacote | Uso |
|---------|--------|-----|
| `CommentReplyCommand` | `core-comments` | Responder a um comentário |

### Pacotes de Suporte

| Pacote | Responsabilidade | Status |
|--------|------------------|--------|
| `core-connectors` | Manifest e capabilities | active |
| `core-runtime` | Runtime unificado (correlação, dedupe, assinatura, rate-limit) | active |
| `core-auth` | Tokens OAuth, storage de credenciais | active |
| `core-sync` | Checkpoints, sync pull/push | active |
| `core-ads` | Schemas de leads e formulários | active |
| `core-comments` | Schemas de comentários e replies | active |
| `core-rate-limit` | Rate limiting e backoff | active |
| `core-messaging` | Tipos outbound implementados; DMs inbound planned | **partial** |
| `core-reactions` | Reações (likes, emojis) em posts/comentários | **planned** |

### Pacotes de Provedores

| Pacote | Uso | Estado atual |
|--------|-----|--------------|
| `core-meta-whatsapp` | Parsing de webhooks do WhatsApp Business, fixtures reais e testes de batch/dedupe | ativo e usado em `apps/whatsapp` |
| `core-meta-instagram` | Parsing de webhooks de Instagram DM; cliente de reply de comentário (library only, não wired) | inbound DM ativo; `comment_reply` permanece *planned* |

---

## Domínios Parcialmente Implementados

### `core-messaging` (partial)

**Responsabilidade**: Tipos e schemas para mensagens diretas (DMs).

**Status atual (implementado):**
- `OutboundMessageIntent` — schema Zod para intents de envio outbound
- `OutboundMessagePayload` — tipos de payload (text por enquanto)
- Usado por `core-runtime` (outbound) e `core-meta-whatsapp` (sendMessage)

**Planned (não implementado):**
- Schemas específicos de DM inbound (threads, typing indicators, read receipts)
- Parsing de payloads de provedores (Meta DM webhook → `DirectMessage`)
- Helpers de dedupe key para mensagens diretas inbound

**Distinção de `core-events`**: `core-events` define o envelope genérico `ConversationMessageReceived`. `core-messaging` adiciona tipos específicos de mensagens diretas.

**Relação com `core-runtime`**: Conectores usam `core-runtime` para webhook handling; `core-messaging` fornece tipos para outbound e (futuramente) `parseEvent` específico para DMs.

---

## Domínios Planejados

### `core-reactions` (planned)

**Responsabilidade**: Normalização de reações (likes, emojis, reactions) em posts, comentários e mensagens.

**Distinção de `core-comments`**: `core-comments` trata o conteúdo textual de comentários. `core-reactions` trata ações de engagement sem texto:
- Likes em posts/stories
- Reações com emoji em comentários
- Reactions em mensagens (👍, ❤️, etc.)

**Eventos esperados**:
| Tipo | Descrição |
|------|-----------|
| `Reaction` | Reação normalizada (emoji, tipo, target) |
| `ReactionRemoved` | Remoção de reação |

**Relação com `core-runtime`**: Conectores registram capability `reaction_ingest` no manifest; `core-reactions` fornece parsing e dedupe key helpers.

---

## Connector Manifest

Todo conector deve exportar um `ConnectorManifest` que declara suas capabilities e metadados.

### Schema

```typescript
interface ConnectorManifest {
  id: string;              // Identificador único (ex: 'instagram')
  name: string;            // Nome legível (ex: 'Instagram Business')
  version: string;         // Semver (ex: '0.1.0')
  platform: string;        // Provedor (ex: 'meta', 'google')
  capabilities: Capability[];
  webhookPath: string;     // Default: '/webhook'
  healthPath: string;      // Default: '/health'
  requiredEnvVars: string[];
  optionalEnvVars: string[];
  auth?: AuthConfig;       // Configuração de autenticação
  webhook?: WebhookConfig; // Configuração de webhook
}

interface Capability {
  id: CapabilityId;        // Ver lista de capabilities
  status: 'active' | 'planned' | 'disabled';
  description?: string;
}

interface AuthConfig {
  type: 'none' | 'api_key' | 'oauth2' | 'system_jwt';
  oauth?: OAuthConfig;     // Obrigatório quando type = 'oauth2'
}

interface OAuthConfig {
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  redirectUrl?: string;
  audience?: string;
  pkce: boolean;           // Default: false
}

interface WebhookConfig {
  path: string;
  signature?: WebhookSignatureConfig;
}

interface WebhookSignatureConfig {
  enabled: boolean;
  algorithm: 'hmac-sha256' | 'none';
  requireRawBody: boolean;
}
```

### Exemplo (Instagram)

```typescript
import { capability, type ConnectorManifest } from '@connectors/core-connectors';

export const instagramManifest: ConnectorManifest = {
  id: 'instagram',
  name: 'Instagram Business',
  version: '0.1.0',
  platform: 'meta',
  capabilities: [
    capability(
      'inbound_messages',
      'active',
      'Receive DMs via webhook (production requires shared dedupe store)'
    ),
    capability('comment_ingest', 'planned', 'Receive comments on posts'),
    capability('comment_reply', 'planned', 'Reply to comments via API (library only, not wired)'),
    capability('ads_leads_ingest', 'planned', 'Receive leads from Lead Ads'),
    capability('webhook_verification', 'active', 'Meta webhook verification'),
  ],
  webhookPath: '/webhook',
  healthPath: '/health',
  requiredEnvVars: ['INSTAGRAM_VERIFY_TOKEN'],
  optionalEnvVars: ['INSTAGRAM_WEBHOOK_SECRET', 'INSTAGRAM_ACCESS_TOKEN'],
};
```

### Exemplo com OAuth2 e Webhook Signature

```typescript
import { capability, type ConnectorManifest } from '@connectors/core-connectors';

export const instagramManifestWithAuth: ConnectorManifest = {
  id: 'instagram',
  name: 'Instagram Business',
  version: '0.2.0',
  platform: 'meta',
  capabilities: [
    capability(
      'inbound_messages',
      'active',
      'Receive DMs via webhook (production requires shared dedupe store)'
    ),
    capability('comment_ingest', 'planned', 'Receive comments on posts'),
    capability('comment_reply', 'planned', 'Reply to comments via API (library only, not wired)'),
    capability('ads_leads_ingest', 'planned', 'Receive leads from Lead Ads'),
    capability('webhook_verification', 'active', 'Meta webhook verification'),
  ],
  webhookPath: '/webhook',
  healthPath: '/health',
  requiredEnvVars: ['INSTAGRAM_VERIFY_TOKEN'],
  optionalEnvVars: ['INSTAGRAM_WEBHOOK_SECRET', 'INSTAGRAM_ACCESS_TOKEN'],
  
  // Configuração OAuth2 para Facebook Login
  auth: {
    type: 'oauth2',
    oauth: {
      authorizationUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
      scopes: [
        'pages_messaging',
        'pages_manage_metadata',
        'instagram_basic',
        'instagram_manage_messages',
        'instagram_manage_comments',
      ],
      redirectUrl: 'https://app.example.com/oauth/callback',
      pkce: false, // Meta não suporta PKCE atualmente
    },
  },
  
  // Configuração de webhook signature
  webhook: {
    path: '/webhook',
    signature: {
      enabled: true,
      algorithm: 'hmac-sha256',
      requireRawBody: true, // Obrigatório para validação HMAC
    },
  },
};
```

### Uso

```typescript
import { hasCapability } from '@connectors/core-connectors';
import { instagramManifest } from './manifest.js';

if (hasCapability(instagramManifest, 'inbound_messages', 'active')) {
  // Registrar handler inbound (já wired no app)
}
```

---

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
  - Para deploy multi-instância (Kubernetes, ECS, etc.), use `RedisDedupeStore` ou implemente `DedupeStore` com outro backend persistente.
  - O TTL deve ser configurado de acordo com a janela de retry do Meta (recomendado: 5-15 minutos).

### Deduplicação Distribuída

O `RedisDedupeStore` fornece deduplicação persistente para ambientes multi-instância:

```typescript
import { createRedisDedupeStore } from '@connectors/core-runtime';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);
const dedupeStore = createRedisDedupeStore(redis, {
  keyPrefix: 'dedupe:whatsapp:',  // Prefixo para isolar por conector
  failMode: 'closed',            // 'open' = bloqueia em erro, 'closed' = permite
  onError: (err) => logger.error('Redis dedupe error', { error: err }),
});

const app = buildWebhookApp({
  manifest: whatsappManifest,
  parseEvent,
  dedupeStore,        // Substitui o InMemoryDedupeStore padrão
  dedupeTtlMs: 600000, // 10 minutos
});
```

**Fail Modes:**
- `open` (default): Trata erros de Redis como duplicata → bloqueia o evento (seguro, evita reprocessamento)
- `closed`: Trata erros como não-duplicata → permite o evento (disponibilidade, risco de reprocessar)

**Interface `RedisClient`:**
Compatível com `ioredis` e `node-redis`. Requer apenas:
- `set(key, value, 'PX', ttlMs, 'NX'): Promise<'OK' | null>`
- `quit(): Promise<unknown>`

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

- **Response shape (sucesso batch):**
  ```json
  {
    "ok": true,
    "fullyDeduped": false,
    "correlationId": "mkiquc-abc123",
    "summary": { "total": 3, "processed": 2, "deduped": 1, "failed": 0 },
    "results": [
      { "capabilityId": "inbound_messages", "dedupeKey": "k1", "ok": true, "deduped": false, "correlationId": "..." }
    ]
  }
  ```
- **Response shape (erro):** `{ ok: false, code: string, message: string, correlationId: string }`
- **Campo `fullyDeduped`:** Boolean canônico — `true` apenas quando TODOS os itens foram dedupados
- **Campo `summary.deduped`:** Número — contagem de itens dedupados
- **Campo `results[].deduped`:** Boolean — status de dedupe por item
- **Códigos de erro padrão:** `WEBHOOK_VALIDATION_FAILED` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `RATE_LIMIT_EXCEEDED` (429), `SERVICE_UNAVAILABLE` (503), `INTERNAL_ERROR` (500)
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

### rawBodyMiddleware Obrigatório

Quando `webhook.signature.requireRawBody: true` está configurado no manifest, o conector **deve** aplicar `rawBodyMiddleware()` do `adapter-express` antes de qualquer parser JSON.

**Por que é necessário:**

1. **Integridade da assinatura:** O Meta (e outros provedores) assina o corpo literal da requisição HTTP. Após o parse JSON, o corpo original é perdido e a assinatura não pode ser verificada.

2. **Comparação byte-a-byte:** A validação HMAC compara o hash do corpo recebido com o hash esperado. Qualquer diferença (espaços, encoding, ordem de campos) invalida a assinatura.

**Uso correto:**

```typescript
import { rawBodyMiddleware, createExpressAdapter } from '@connectors/adapter-express';

const app = express();

// 1. rawBodyMiddleware PRIMEIRO - captura Buffer original
app.use(rawBodyMiddleware());

// 2. Depois o adapter configura rotas com acesso a req.rawBody
const adapter = createExpressAdapter({ app });
```

**Erro comum:**

```typescript
// ❌ ERRADO: express.json() antes de rawBodyMiddleware
app.use(express.json());
app.use(rawBodyMiddleware()); // rawBody estará vazio!

// ✅ CORRETO: rawBodyMiddleware antes de qualquer parser
app.use(rawBodyMiddleware()); // Captura Buffer antes do parse
```

**Detecção de configuração incorreta:**

Se o manifest declara `webhook.signature.requireRawBody: true` mas `req.rawBody` está vazio, o runtime deve:
- Logar warning: `"rawBody not available for signature verification"`
- Retornar 500 com `INTERNAL_ERROR` (não 401, pois é erro de configuração, não de assinatura)

### Dedupe Policy

- **Interface:** `DedupeStore` com método `isDuplicate(key: string): Promise<boolean>`
- **Stores disponíveis:** `InMemoryDedupeStore` (default), `NoopDedupeStore`
- **TTL default:** 5 minutos (300.000ms)
- **Chave:** `event.dedupeKey` (formato: `{channel}:{externalId}`)
- **Resposta em duplicata:** `{ ok: true, deduped: true, correlationId }` (200, não reprocessa)

### Logging Baseline

- **Formato:** JSON estruturado via `createLogger()` do `core-logging`
- **Campos mínimos:** `service`, `correlationId`, `tenantId`, `eventId`, `eventType`, `dedupeKey`
- **Campos por item (batch):** `capabilityId`, `dedupeKey`, `outcome`, `latencyMs`, `errorCode`
- **Mensagens padrão:**
  - `"Event processed successfully"` — sucesso por item
  - `"Duplicate event skipped"` — dedupe por item
  - `"Signature validation skipped"` — sem secret configurado
  - `"Event parsing failed"` — 400
  - `"Signature verification failed"` — 401
  - `"Handler execution failed"` — erro no handler

### Logging & PII Security

O runtime **nunca loga payloads brutos**. Campos logados:

| ✅ Permitido | ❌ Proibido |
|-------------|-------------|
| `correlationId` | `request.body` |
| `capabilityId` | `event.payload` |
| `dedupeKey` | Conteúdo de mensagens |
| `outcome` | Dados de usuário |
| `latencyMs` | Telefones, emails |
| `errorCode` | Nomes, endereços |

**Responsabilidade do handler:** Ao implementar handlers, **não logue `event.payload` diretamente**:

```typescript
// ❌ RUIM - expõe PII
ctx.logger.info('Processando', { payload: event.payload });

// ✅ BOM - apenas metadados não-sensíveis
ctx.logger.info('Processando', { 
  messageId: event.payload.id,
  messageType: event.payload.type 
});
```

### Testing Baseline

- **Framework:** Vitest + Supertest
- **Casos mínimos para cada conector:**
  1. Health check (`GET /health` → 200)
  2. Payload válido → 200 com `fullyDeduped: false`
  3. Payload duplicado → 200 com `fullyDeduped: true`
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
├── tsconfig.build.json
├── vitest.config.ts
├── src/
│   ├── app.ts            # buildApp() com middlewares e rotas
│   ├── manifest.ts       # ConnectorManifest exportado
│   └── server.ts         # entry point
└── tests/
    └── webhook.test.ts   # casos mínimos acima
```

### Checklist de Novo Conector

- [ ] Criar app em `apps/{connector}/`
- [ ] Criar `src/manifest.ts` com `ConnectorManifest` declarando capabilities
- [ ] Configurar `auth` no manifest (escolher: `none`, `api_key`, `oauth2`, `system_jwt`)
- [ ] Se `auth.type = oauth2`: configurar `oauth.authorizationUrl`, `oauth.tokenUrl`, `oauth.scopes`
- [ ] Configurar `webhook.signature` no manifest se o provedor requer validação
- [ ] Se `webhook.signature.requireRawBody = true`: aplicar `rawBodyMiddleware()` ANTES de rotas POST
- [ ] Implementar `correlationIdMiddleware()` (pode copiar do WhatsApp/Instagram)
- [ ] Implementar `signatureValidationMiddleware()` com secret específico
- [ ] Usar `createWebhookProcessor()` com `parseEvent` e `onEvent`
- [ ] Implementar GET verify específico do provedor (se aplicável)
- [ ] Implementar `/health` retornando `{ status: 'ok', connector: manifest.id }`
- [ ] Definir variáveis de ambiente: `PORT`, `{CONNECTOR}_VERIFY_TOKEN`, `{CONNECTOR}_WEBHOOK_SECRET`
- [ ] Adicionar testes do manifest (capabilities declaradas)
- [ ] Adicionar testes das novas configurações `auth` e `webhook.signature`
- [ ] Escrever todos os testes mínimos de webhook
- [ ] Documentar endpoints em `docs/architecture.md`

### Conectores Implementados

| Conector | ID | Platform | Status | Capabilities Ativas |
|----------|-----|----------|--------|---------------------|
| WhatsApp | `whatsapp` | meta | ✅ Active | inbound_messages, message_status_updates, webhook_verification |
| Instagram | `instagram` | meta | ✅ Active | inbound_messages, webhook_verification |
| Calendar | `calendar` | google | 📋 Planned | (scaffold apenas) |
| Automation | `automation` | zapier | 📋 Planned | (scaffold apenas) |
