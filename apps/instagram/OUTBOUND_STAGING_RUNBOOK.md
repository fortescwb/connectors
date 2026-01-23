# Instagram Outbound DM Texto — Staging Runbook (IG-O2)

Status: **scaffold** (somente DM texto). Promover para `active` apenas após evidência real nos cenários abaixo.

## 0) Pré-requisitos de ambiente
- `ENABLE_OUTBOUND_STAGING=true` (habilita endpoint protegido `/__staging/outbound`).
- `STAGING_OUTBOUND_TOKEN=<token>` (header `X-Staging-Token` obrigatório).
- `INSTAGRAM_ACCESS_TOKEN=<token da página/IG>` com permissão para enviar DM.
- `INSTAGRAM_BUSINESS_ACCOUNT_ID=<page_id/ig_business_id>` (destino do endpoint Graph `/messages`).
- `INSTAGRAM_GRAPH_BASE_URL` opcional (default: `https://graph.facebook.com`).
- `INSTAGRAM_GRAPH_API_VERSION` opcional (default: `v19.0`).
- `REDIS_URL=<redis://...>` para dedupe exatamente-once (InMemory só para dev local).

## 1) Construir o intent canônico (DM texto)
Use `clientMessageId` obrigatório e dedupeKey derivado de (recipientId, clientMessageId):
```
const dedupeKey = buildInstagramOutboundDmDedupeKey(recipientId, clientMessageId);
```
Payload de exemplo (`apps/instagram` staging):
```json
{
  "intents": [
    {
      "intentId": "550e8400-e29b-41d4-a716-446655440000",
      "clientMessageId": "ig-stg-text-001",
      "tenantId": "tenant-stg-ig",
      "provider": "instagram",
      "to": "<recipient_ig_user_id>",
      "payload": { "type": "text", "text": "hello from staging" },
      "dedupeKey": "instagram:outbound:dm:<recipient_ig_user_id>:ig-stg-text-001",
      "correlationId": "corr-ig-stg-text-001",
      "createdAt": "2026-01-23T00:00:00.000Z"
    }
  ]
}
```
> `recipient_ig_user_id` precisa ser um usuário que já enviou DM para a página.

## 2) Enviar no endpoint staging (edge)
```
curl -X POST "https://<host>/__staging/outbound" \
  -H "Content-Type: application/json" \
  -H "X-Staging-Token: $STAGING_OUTBOUND_TOKEN" \
  -d @intent.json
```
Resposta esperada (sucesso):
- `status 200`, body `{ ok: true, result: { summary: { total, sent, deduped, failed } } }`
- Log estruturado: `correlationId`, `dedupeKey`, `status`, `providerMessageId` (se retornado), sem payload.

## 3) Cenários obrigatórios (capturar evidência)
Registre correlationId + resultado para cada cenário:
1) **Envio DM texto (200)** — guarda `providerMessageId` e status.
2) **Replay idêntico (mesmo clientMessageId)** — espera `deduped=1`, `sent=0`.
3) **Erro não-retryable** — use token inválido para forçar 401/403; verificar `errorCode`/`retry=false` e sem payload em logs.

Use a tabela abaixo para evidências (sem PII):
| Data | CorrelationId | Scenario | providerMessageId | summary | Observação |
| --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | corr-ig-stg-text-001 | send text | msg_id? | sent=1 deduped=0 failed=0 | |
| YYYY-MM-DD | corr-ig-stg-text-002 | replay | (n/a) | sent=0 deduped=1 failed=0 | |
| YYYY-MM-DD | corr-ig-stg-text-003 | invalid token | (n/a) | sent=0 deduped=0 failed=1 | |

## 4) Promoção (somente se 3/3 cenários ok)
- Atualizar `apps/instagram/src/manifest.ts`: `outbound_messages` → `active` **somente para DM texto**.
- Atualizar README/doks com escopo: "DM texto active; mídia permanece scaffold".
- Se qualquer cenário falhar, manter `planned` e registrar gaps aqui.

## 5) Notas de segurança / PII
- Nenhum log de payload ou token; logs contêm apenas metadados (status, correlationId, dedupeKey, providerMessageId). 
- DedupeKey: não incluir texto ou nome de usuário; use somente `recipientId` + `clientMessageId` (já mascarado no store).

## 6) Rollback
- Se regressão: desabilitar `ENABLE_OUTBOUND_STAGING` ou revogar `STAGING_OUTBOUND_TOKEN`; manter capability como `planned`.
