# Instagram Outbound DM Texto — Evidências de Staging (IG-O2.2)

Status: **pendente** — cenários não executados neste ambiente (sem acesso a staging/token). Use o template abaixo para registrar as execuções reais antes de qualquer promoção.

## Como preencher (resumo)
1) Siga o runbook: `apps/instagram/OUTBOUND_STAGING_RUNBOOK.md`.
2) Para cada cenário, capture correlationId e clientMessageId (parcial/mascarado se necessário) e o resumo da resposta.
3) Não registrar payloads, tokens ou IDs pessoais.

## Evidências
| Data (UTC) | Ambiente | Cenário | CorrelationId | ClientMessageId | HTTP Status | providerMessageId | Outcome | Observações |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| YYYY-MM-DD | staging | DM texto (envio) | corr-ig-stg-text-001 | ig-stg-text-001 | 2xx | msg_id (mascarado) | success | |
| YYYY-MM-DD | staging | Replay deduped | corr-ig-stg-text-002 | ig-stg-text-001 | 200 | n/a | deduped | deduped=true; sent=0 |
| YYYY-MM-DD | staging | Token inválido | corr-ig-stg-text-003 | ig-stg-text-003 | 401/403 | n/a | error_non_retryable | retry=false |

## Promoção
- **Atual**: `outbound_messages` permanece **planned** (DM texto ainda não validado neste ciclo).
- **Condição para promover**: 3/3 cenários acima com evidência real em staging.
- **Após promover**: atualizar `apps/instagram/src/manifest.ts` e README (escopo: apenas DM texto; mídia continua scaffold).

## Notas de PII
- Não inserir texto de mensagem, tokens ou IDs pessoais; providerMessageId pode ser mascarado (ex.: `mid_***123`).
