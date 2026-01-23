# Instagram Inbound – Staging Validation Runbook (Gate T3.2)

> Objetivo: validar inbound DM no ambiente **staging** sem promover capability para `active`. Foco em prova operacional, PII-safe e batch/dedupe comportando-se como esperado.

## 0. Pré-requisitos (contas e app Meta)
- Business/Creator IG conectado a uma **Página** com permissões de mensagens.
- App Meta com produtos **Instagram Graph API** e **Webhooks** habilitados.
- Permissões aprovadas/sandbox liberado: `instagram_basic`, `pages_manage_metadata`, `pages_read_engagement`, `instagram_manage_messages`, `instagram_manage_inbox`.
- Assinatura Webhook: tópico `instagram` com campo `messages` (ou `instagram_messages`, conforme console).

## 1. Configuração de ambiente (staging)
- Variáveis obrigatórias no deploy:
  - `INSTAGRAM_VERIFY_TOKEN=<verify-token-staging>`
  - `INSTAGRAM_WEBHOOK_SECRET=<secret-staging>` (usado na assinatura X-Hub-Signature-256)
  - `REDIS_URL=<redis-dedupe-staging>`
- Opcional (outbound permanece inativo neste gate):
  - `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `INSTAGRAM_PAGE_ID`, `STAGING_OUTBOUND_TOKEN`.
- Endpoint público esperado (já configurado na app): `POST https://<staging-host>/webhook`.

## 2. Checklist de inscrição / handshake
1) No Dashboard do App, configure o endpoint `https://<staging-host>/webhook` e o Verify Token acima.  
2) Salve e clique em “Verify and Save” – deve retornar **200** com o challenge.  
3) Habilite o campo `messages`.  
4) Adicione a Página/IG de staging ao app e conceda as permissões listadas.

## 3. Cenários a validar (executar em ordem)
| # | Cenário | Como executar | Evidência esperada |
|---|---------|---------------|--------------------|
| 1 | DM texto simples | Enviar DM do usuário de teste para o IG de staging | `200`, `summary.total=1`, `deduped=0`, log sem PII |
| 2 | DM com mídia (imagem ou áudio) | Enviar mídia única | `200`, payload `type=image|audio`, dedupeKey presente |
| 3 | Batch (2 mensagens rápidas) | Enviar 2 DMs em <5s | `summary.total=2`, 2 resultados distintos |
| 4 | Replay dedupe | Reenviar **mesmo raw payload** com mesma assinatura | `200`, `summary.deduped=1`, `fullyDeduped=true` |
| 5 | Assinatura inválida | Reenviar payload com assinatura incorreta | `401`, `code=UNAUTHORIZED`, sem payload em logs |

### Como gerar replay (cenários 4 e 5)
1) Capture o **raw body** e o header `x-hub-signature-256` de uma entrega real (sanitizar antes de versionar).  
2) Reenvie localmente:  
```bash
curl -X POST https://<staging-host>/webhook \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: <captured-or-invalid-signature>" \
  --data '@raw.json'
```

## 4. Observabilidade e PII-safe
- CorrelationId: resposta traz header `x-correlation-id`; use-o para filtrar logs.
- Logs permitidos: `connector`, `capabilityId`, `dedupeKey`, `correlationId`, métricas.  
- Logs proibidos: payload, texto da mensagem, telefone, tokens. (Coberto pelos testes T2.2 – revalidar amostras manuais).
- Para checar rapidamente:  
```bash
kubectl logs <pod> | grep <correlation-id>
```
Verifique que não há texto da DM ou números completos.

## 5. Registro de evidências (preencha após execução)
- Data da execução:
- IG handle / Página usada:
- CorrelationIds por cenário (1–5):
- Resumo por cenário: `status`, `summary`, `results` (sem PII).
- Observações/gaps (ex.: tipo de mídia não entregue, latência alta, erro de permissão).

## 6. Critérios para promoção futura a `active`
- ✅ Cenários 1–5 concluídos com evidências e sem PII em logs.  
- ✅ Dedupe confirmado (replay) com Redis de staging.  
- ✅ Assinatura/verify funcionando (200/401/403 conforme contrato).  
- ✅ Pelo menos 1 mídia real recebida e parseada (`type=image|audio|video`), dedupeKey correto.  
- ✅ Nenhum 5xx não explicado no app durante a janela de validação.  
- 📄 Fixtures reais sanitizadas adicionadas ao repo (sem PII) a partir das capturas.  
- 📊 Métrica/observabilidade mínima revisada (latência, summary).

## 7. Roteiro rápido (TL;DR)
1. Garantir envs e webhook verificado (passo 2).  
2. Executar cenários 1–3 (DM texto, mídia, batch) e capturar correlationIds.  
3. Reaplicar raw payload com mesma assinatura (dedupe) e depois com assinatura inválida.  
4. Checar logs por correlationId (sem PII).  
5. Documentar evidências e decidir promoção no próximo gate.
