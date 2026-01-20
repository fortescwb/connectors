# @connectors/core-meta-graph

Shared Meta Graph API base client used by WhatsApp, Instagram e Messenger adapters.

## O que entrega

- HTTP client padronizado (`createGraphClient`) com `baseUrl`, `apiVersion` (`v19.0` default) e auth `Bearer`.
- Retry/backoff uniforme com suporte a `Retry-After` (429) e erros transitórios (`is_transient`, 5xx).
- Normalização de erros (`MetaGraphError` + subclasses) e `classifyError` para códigos Meta (`4/17/613` → rate_limit, `190` → auth, etc.).
- Observabilidade mínima sem PII: logs estruturados por tentativa (`endpoint`, `status`, `latencyMs`, `retryable`, `fbtraceId`), sem payloads.
- Helpers reutilizáveis: `buildGraphUrl`, `maskAccessToken`, `maskNumeric`, `parseRetryAfter`.

## Uso básico

```typescript
import { createGraphClient } from '@connectors/core-meta-graph';

const graph = createGraphClient({
  accessToken: process.env.META_TOKEN!,
  apiVersion: 'v19.0',
  context: { connector: 'whatsapp', capabilityId: 'outbound_messages' }
});

const response = await graph.post('123456/messages', {
  messaging_product: 'whatsapp',
  to: '+15551234567',
  text: { body: 'hello' }
});
```

## Erros normalizados

- `MetaGraphRateLimitError` (`code = rate_limit`, `retryAfterMs` respeitado)
- `MetaGraphAuthError` (`auth_error` para 401/403/190/10/200)
- `MetaGraphClientError` (`client_error` para 4xx não-transitórios)
- `MetaGraphServerError` (`server_error`, retryable)
- `MetaGraphTimeoutError` / `MetaGraphNetworkError` (retryable)

`classifyError(status, graphError, headers)` retorna `{ code, retryable, retryAfterMs }` para uso em adapters específicos.

## Observabilidade e segurança

- Logs **não incluem payload** nem access tokens (somente metadados: endpoint, status, retry, fbtraceId).
- Máscaras utilitárias: `maskAccessToken()` e `maskNumeric()` para mensagens de erro.
- Contexto opcional (`connector`, `capabilityId`, `correlationId`, `channel`) propagado em todos os logs.

## Testes

```bash
pnpm test   # vitest (unitário, sem rede)
pnpm lint   # eslint
pnpm build  # tsc
```
