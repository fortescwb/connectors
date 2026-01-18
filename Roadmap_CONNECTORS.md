# 🧭 Roadmap Geral — Connectors / Runtime Unificado

## Fase 0 — Estado Atual (CONCLUÍDA)

**Status:** ✅ concluída

**Objetivos atingidos**

* Runtime unificado (`core-runtime`)
* Contratos estáveis (`core-connectors`, `core-events`)
* Dedupe distribuído (`RedisDedupeStore`)
* Apps scaffold (WhatsApp, Instagram, Calendar, Automation)
* Documentação alinhada (README + architecture.md)

**Resultado**

> Base sólida, extensível e sem débito técnico estrutural.

---

Perfeito. Vou te entregar 3 coisas, do jeito que vira execução sem “interpretação criativa”:

1. **Issue tree** (épicos → stories → tasks)
2. **Ordem de execução** (para minimizar retrabalho e risco)
3. **Lista de arquivos-alvo** (existentes + novos) por entrega, alinhada com o repo que você mandou

Abaixo, tudo pensado para o **monorepo atual** (`apps/*`, `packages/*`) e para o runtime existente (`packages/core-runtime`), que hoje só processa **1 evento por POST**.

---

## 1) Issue tree — Fase 1 (detalhada)

### EPIC F1.0 — Runtime: suporte a lote (N eventos por request) + resposta padronizada

**Objetivo:** destravar Meta webhooks reais (que chegam em batch), mantendo dedupe e correlação por item.

**F1.0.1 — Alterar contrato do parser: `parseEvent` → `parseEvents`**

* **Task:** Criar novo tipo `EventBatchParser<TPayload> = (req) => ParsedEvent<TPayload>[] | Promise<...>`
* **Task:** Atualizar `RuntimeConfig` para aceitar `parseEvents` (mantendo compat: aceitar `parseEvent` deprecated por 1 ciclo, se você quiser suavizar migração)
* **Task:** Atualizar `buildWebhookHandlers.handlePost()` para:

  * validar signature uma vez (por request)
  * parsear N eventos
  * iterar eventos aplicando: correlationId, rate-limit, dedupe, handler
  * acumular resultado agregado (ex.: `processed`, `deduped`, `failed`)
  * retornar `200` se **nenhum erro fatal de parse/signature** (falha de handler vira erro por item, mas não 500 geral)

**F1.0.2 — Modelo de resposta em batch**

* **Task:** Criar `BatchSuccessResponseBody` com:

  * `ok: true`
  * `correlationId` do request (fallback)
  * `summary: { total, processed, deduped, failed }`
  * `results?: Array<{ dedupeKey, capabilityId, ok, deduped, correlationId?, errorCode? }>` (opcional; em prod você pode manter apenas summary)
* **Task:** Garantir que logs incluam `dedupeKey` por item (não só por request)

**Critérios de aceite**

* Um POST com 10 itens gera 10 processamentos e 10 dedupes possíveis.
* Signature verificada 1 vez (sem custo multiplicado).
* `200` em lote válido, mesmo que 1 item falhe no handler (erro fica por item, logado).

---

### EPIC F1.1 — WhatsApp inbound real (Meta payload → eventos normalizados) + status mapping completo

**Objetivo:** parar de depender de `parseEventEnvelope(request.body)` (fake) e aceitar webhook real.

**F1.1.1 — Criar pacote de parsing Meta WhatsApp**

* **Task:** Criar `packages/core-meta-whatsapp` (ou `packages/core-meta` com submódulos; recomendo o específico agora)

  * `parseWhatsAppWebhook(body): ParsedEvent[]`
  * `mapWhatsAppMessageToEvent(...)` → `capabilityId: inbound_messages`
  * `mapWhatsAppStatusToEvent(...)` → `capabilityId: message_status_updates`
  * `dedupeKey` determinístico por item:

    * mensagens: `whatsapp:<phone_number_id>:msg:<message_id>`
    * status: `whatsapp:<phone_number_id>:status:<status_id_or_message_id>:<status>`
  * validação com `zod` (use `packages/core-validation` se ele expõe helpers; senão, direto no pacote novo)

**F1.1.2 — Atualizar app WhatsApp para usar parse real + batch**

* **Task:** Atualizar `apps/whatsapp/src/app.ts` para usar `parseEvents` e o pacote novo
* **Task:** No manifest (`whatsappManifest`), promover:

  * `message_status_updates` → **active** quando pronto
  * `outbound_messages` continua planned até EPIC F1.2

**F1.1.3 — Fixtures reais + testes**

* **Task:** Criar fixtures de payload Meta (mínimo):

  * mensagem texto
  * mensagem com attachment (se quiser: imagem/áudio)
  * status `sent`, `delivered`, `read`, `failed`
  * batch com múltiplas mensagens e múltiplos statuses
* **Task:** Atualizar `apps/whatsapp/tests/webhook.test.ts`:

  * valida que 1 POST batch chama handler N vezes (ou que runtime retorna summary coerente)
  * valida dedupe por item
  * valida `failed` não estoura 500

**Critérios de aceite**

* `apps/whatsapp` aceita payload real da Meta.
* `message_status_updates` gera eventos `sent/delivered/read/failed` normalizados, com dedupe por item.
* Testes cobrem batch + idempotência + falhas.

---

### EPIC F1.2 — WhatsApp outbound (Messages API) com retry/backoff, classificação de erros e idempotência

**Objetivo:** envio outbound pronto para tráfego real.

**F1.2.1 — Criar pacote HTTP comum (timeouts + retries + classificação)**

* **Task:** Criar `packages/core-http`:

  * `requestJson({ method, url, headers, body, timeoutMs })`
  * integração com `withRetry()` (`packages/core-rate-limit`)
  * `shouldRetryError(err)` baseado em status code (429/5xx/timeouts)
  * suporte a `Retry-After` quando existir

**F1.2.2 — Implementar client WhatsApp Graph**

* **Task:** Criar `packages/core-meta-whatsapp/src/client.ts`:

  * `sendMessage(...)` (text inicialmente)
  * retorna `providerMessageId`
* **Task:** Implementar handler capability `outbound_messages` no app WhatsApp (ou expor um handler que o core chamaria)

  * Por enquanto, pode ser um endpoint interno (ex.: `POST /commands/send-message`) só para teste local
  * Em produção, isso vira consumo de fila/worker (fase futura), mas você precisa do código e testes agora

**F1.2.3 — Idempotência de outbound**

* **Task:** Definir `clientMessageId` gerado no core e passado ao conector
* **Task:** Persistência mínima (MVP): usar `dedupeStore` (Redis) também para outbound command keys:

  * `whatsapp:outbound:<tenant>:<clientMessageId>` TTL longo (ex.: 24h)
* **Task:** Se request timeout após envio, evitar reenvio “cego”

**Critérios de aceite**

* `outbound_messages` envia e retorna `providerMessageId`.
* Falhas transitórias fazem retry com backoff.
* Timeout não duplica envio.

---

### EPIC F1.3 — Observabilidade mínima: contrato de logs + métricas básicas (via logs)

**Objetivo:** você conseguir operar sem “adivinhar”.

**F1.3.1 — Campos obrigatórios de log**

* **Task:** Padronizar logs no runtime por item:

  * `service`, `connector`, `correlationId`, `tenantId?`, `capabilityId`, `dedupeKey`, `eventType?`
* **Task:** Garantir que **não** se loga payload bruto em erro (somente metadados)

**F1.3.2 — Métricas mínimas (log-based)**

* **Task:** Emitir logs/contadores para:

  * `webhook_received_total`
  * `event_processed_total`
  * `event_deduped_total`
  * `event_failed_total`
  * `handler_latency_ms`

**Critérios de aceite**

* Dado um correlationId, você reconstrói o caminho request → itens → handler → resultado.

---

### EPIC F1.4 — Instagram DM inbound/outbound mínimo + batch parser real

**Objetivo:** sair de scaffold e chegar na paridade mínima com WhatsApp.

**F1.4.1 — Criar pacote parsing Meta Instagram DM**

* **Task:** Criar `packages/core-meta-instagram`:

  * `parseInstagramWebhook(body): ParsedEvent[]` para DMs
  * mapping para `inbound_messages` e (se aplicável) `message_status_updates`
  * dedupeKey por item

**F1.4.2 — Atualizar app Instagram para usar parse real**

* **Task:** Alterar `apps/instagram/src/app.ts` para usar `parseEvents` do pacote
* **Task:** Promover capabilities para active conforme implementar:

  * `outbound_messages` quando pronto
  * `message_status_updates` quando pronto

**F1.4.3 — Testes e fixtures**

* **Task:** Criar fixtures de DM inbound e batch
* **Task:** Criar/expandir `apps/instagram/tests/webhook.test.ts` (se não existir, criar)

**Critérios de aceite**

* Instagram recebe payload real DM e emite eventos normalizados em batch.

---

### EPIC F1.5 — Instagram Comments: reply completo

**Objetivo:** fechar o ciclo comentário → reply.

**F1.5.1 — Implementar comando normalizado `CommentReplyCommand`**

* Você já cita isso no `docs/architecture.md` e tem `packages/core-comments`.
* **Task:** Confirmar/implementar schema do command em `core-comments` (se ainda não existir)

**F1.5.2 — Implementar client Graph para reply**

* **Task:** `packages/core-meta-instagram/src/client.ts`:

  * `replyToComment(commentId, message)`
* **Task:** Handler de `comment_reply` no app Instagram

**Critérios de aceite**

* Dado `externalCommentId`, responde via API e registra resultado.

---

### EPIC F1.6 — Instagram Leads Ads ingest hardening (idempotência + validação)

**Objetivo:** ingest robusto contra retries e drift de payload.

**F1.6.1 — Parser e validação forte**

* **Task:** Usar `packages/core-ads` para schema de lead; criar mapper do payload real
* **Task:** Dedupe por leadId determinístico

**F1.6.2 — “Poison pill handling”**

* **Task:** payload inválido retorna 400 (validation failed) sem derrubar app
* **Task:** logs sem payload

**Critérios de aceite**

* 1000 retries do mesmo lead → processa 1.

---

### EPIC F1.7 — OAuth2 completo (Instagram): refresh + storage real por tenant

**Objetivo:** parar de depender de token manual e suportar expiração.

**F1.7.1 — Expandir `core-auth` com OAuthClient e TokenManager**

* **Task:** `OAuthClient` (authorize URL, exchange, refresh)
* **Task:** `TokenManager.getValidAccessToken()` com refresh automático
* **Task:** lock anti “refresh storm” (mínimo: mutex in-memory por key; depois troca por Redis)

**F1.7.2 — Implementar endpoints OAuth no app Instagram**

* **Task:** `/oauth/start` e `/oauth/callback`
* **Task:** persistir token via `TokenStorage` por `tenantId` + `accountId`

**F1.7.3 — TokenStorage de produção**

* **Task:** Implementar `RedisTokenStorage` (recomendado, já existe Redis para dedupe no runtime)
* **Task:** Testes unitários

**Critérios de aceite**

* Token expira → refresh acontece → outbound continua sem intervenção.

---

### EPIC F1.8 — Docs + Runbook + checklist de deploy

**Objetivo:** “rodar em prod” sem depender de você lembrar detalhes.

**F1.8.1 — README por app**

* env vars required/optional
* endpoints: `/health`, `/webhook` GET/POST
* como validar signature
* como rodar local com fixtures

**F1.8.2 — “Golden path” documentado**

* WhatsApp como referência: do deploy ao teste real

**Critérios de aceite**

* Um dev novo consegue subir local e validar webhook com fixtures.

---

## 2) Ordem de execução recomendada (para minimizar retrabalho)

1. **F1.0 Runtime batch** (bloqueia tudo Meta real)
2. **F1.1 WhatsApp inbound + status + testes** (vira referência e valida runtime batch)
3. **F1.3 Observabilidade mínima** (coloque cedo; sem isso você “acha” que funciona)
4. **F1.2 WhatsApp outbound** (quando inbound estiver sólido; senão você debuga no escuro)
5. **F1.4 Instagram DM inbound (batch) + testes**
6. **F1.5 Comment reply**
7. **F1.6 Leads hardening**
8. **F1.7 OAuth2 completo** (pode começar em paralelo com F1.4, mas só “fecha” quando outbound entrar)
9. **F1.8 Docs/Runbook** (vai sendo escrito durante, mas finalize no final)

Se você inverter (ex.: tentar OAuth/outbound antes do batch parser), vai pagar imposto de retrabalho: vai ter que reescrever o runtime/app depois.

---

## 3) Lista de arquivos-alvo (existentes + novos)

### EPIC F1.0 — Runtime batch

**Alterar**

* `packages/core-runtime/src/index.ts`

  * adicionar `parseEvents` no `RuntimeConfig`
  * alterar `buildWebhookHandlers.handlePost()` para iterar batch

**Adicionar (opcional, mas recomendado para organização)**

* `packages/core-runtime/src/types.ts` (se quiser separar os tipos e reduzir o tamanho do index)

**Testes**

* `packages/core-runtime/tests/batch.test.ts` (novo)
* Atualizar qualquer teste existente se quebrar contrato

---

### EPIC F1.1 — WhatsApp inbound + status

**Alterar**

* `apps/whatsapp/src/app.ts`

  * trocar `parseEvent` por `parseEvents` real
  * registry deve ter handlers para:

    * `inbound_messages`
    * `message_status_updates` (quando promover)

**Adicionar**

* `packages/core-meta-whatsapp/package.json`
* `packages/core-meta-whatsapp/src/index.ts`
* `packages/core-meta-whatsapp/src/parseWebhook.ts`
* `packages/core-meta-whatsapp/src/mapMessage.ts`
* `packages/core-meta-whatsapp/src/mapStatus.ts`
* `packages/core-meta-whatsapp/src/zodSchemas.ts` (se precisar)
* `packages/core-meta-whatsapp/tests/*.test.ts` (unitários do parser)

**Fixtures**

* `apps/whatsapp/tests/fixtures/meta_webhook_message_text.json`
* `apps/whatsapp/tests/fixtures/meta_webhook_status_sent.json`
* `apps/whatsapp/tests/fixtures/meta_webhook_status_failed.json`
* `apps/whatsapp/tests/fixtures/meta_webhook_batch_mixed.json`

**Testes**

* `apps/whatsapp/tests/webhook.test.ts` (já existe; expandir)

---

### EPIC F1.2 — WhatsApp outbound

**Adicionar**

* `packages/core-http/package.json`

* `packages/core-http/src/index.ts` (requestJson + timeout + retry integration)

* `packages/core-http/src/errors.ts` (tipos de erro e classificação)

* `packages/core-http/tests/*.test.ts`

* `packages/core-meta-whatsapp/src/client.ts` (sendMessage)

* `apps/whatsapp/src/routes/commands.ts` (se você expuser endpoint interno para testar)

* `apps/whatsapp/tests/outbound.test.ts` (novo)

**Alterar**

* `apps/whatsapp/src/app.ts` (registrar capability handler `outbound_messages` quando implementar)

---

### EPIC F1.3 — Observabilidade mínima

**Alterar**

* `packages/core-runtime/src/index.ts` (logs por item + summary do batch)
* `packages/core-logging/src/*` (somente se faltar algo; provável que não precise)

**Adicionar (opcional)**

* `docs/observability.md` (contrato de logs e campos)

---

### EPIC F1.4 — Instagram DM inbound/outbound mínimo

**Alterar**

* `apps/instagram/src/app.ts` (parseEvents real)
* `apps/instagram/src/manifest.ts` (promover capabilities quando pronto)

**Adicionar**

* `packages/core-meta-instagram/package.json`
* `packages/core-meta-instagram/src/index.ts`
* `packages/core-meta-instagram/src/parseWebhook.ts`
* `packages/core-meta-instagram/src/mapDm.ts`
* `packages/core-meta-instagram/src/zodSchemas.ts`
* `apps/instagram/tests/webhook.test.ts` (novo, se não existir)
* `apps/instagram/tests/fixtures/*`

---

### EPIC F1.5 — Comment reply

**Alterar**

* `packages/core-comments/src/index.ts` (se o `CommentReplyCommand` ainda não estiver formalizado lá)
* `apps/instagram/src/manifest.ts` (comment_reply → active)

**Adicionar**

* `packages/core-meta-instagram/src/client.ts` (replyToComment)
* `apps/instagram/src/handlers/commentReply.ts`
* `apps/instagram/tests/commentReply.test.ts`

---

### EPIC F1.6 — Leads ingest hardening

**Alterar**

* `packages/core-ads/src/*` (se faltar schema/contratos)
* `packages/core-meta-instagram/src/parseWebhook.ts` (leads mapping + dedupe)
* `apps/instagram/tests/*` (fixtures e casos de retry)

**Adicionar**

* `apps/instagram/tests/fixtures/meta_lead_valid.json`
* `apps/instagram/tests/fixtures/meta_lead_duplicate.json`
* `apps/instagram/tests/fixtures/meta_lead_invalid.json`

---

### EPIC F1.7 — OAuth2 completo

**Alterar**

* `packages/core-auth/src/index.ts` (adicionar OAuthClient/TokenManager)
* `apps/instagram/src/app.ts` (rotas OAuth)

**Adicionar**

* `packages/core-auth/src/oauthClient.ts`
* `packages/core-auth/src/tokenManager.ts`
* `packages/core-auth/src/redisTokenStorage.ts` (recomendado)
* `packages/core-auth/tests/*`
* `apps/instagram/src/routes/oauth.ts`
* `docs/oauth-instagram.md` (runbook)

---

### EPIC F1.8 — Docs/Runbook

**Adicionar/Alterar**

* `apps/whatsapp/README.md` (ou seção no README raiz)
* `apps/instagram/README.md`
* `docs/runbook-meta-connectors.md`
* `docs/fixtures-and-testing.md`

---

## Um ajuste direto (que vai poupar tempo e retrabalho)

Hoje, `apps/whatsapp/src/app.ts` e `apps/instagram/src/app.ts` têm `capabilities` marcadas como **active** para coisas que ainda são “simuladas” (porque parseia envelope interno, não payload real). Isso é um risco operacional e de governança do repo.

Na execução dessa Fase 1, devemos:

* manter active apenas o que **passa por payload real** + testes
* o resto: planned até fechar o EPIC correspondente

Isso evita “falso pronto para produção”.

---

Sim. E aqui vou ser direto: do jeito que a Fase 2 está escrita, ela ainda é “aspiração”. Para virar execução, você precisa **fixar o contrato canônico** (schemas + eventos) e declarar **quem é responsável por converter payload provider → domínio** (apps vs packages). A decisão correta é: **packages convertem, apps apenas plugam**.

A seguir: **Issue tree + ordem + arquivos-alvo**, no mesmo padrão da Fase 1, para **Fase 2**.

---

# Fase 2 — Domínios Estruturantes (Core Packages) — Detalhada

## Decisões estruturais (antes de codar)

### D2.0 — “Domínio canônico” é o contrato interno, não o payload do provedor

* `core-messaging` define **tipos e invariantes** (o que *sempre* existe).
* Conectores/provedores (Meta WhatsApp, IG, Messenger, etc.) só existem como **adapters** que mapeiam para o domínio.

### D2.1 — DedupeKey e Correlation são responsabilidade do adapter, mas helpers ficam no domínio

* Adapter decide o que entra no `dedupeKey` (porque depende de IDs do provedor).
* `core-messaging` fornece helpers para padronizar formato e reduzir divergência.

### D2.2 — Eventos canônicos devem ser poucos e composáveis

Evite explodir o número de eventos (um por microvariação de payload). O núcleo deve ser:

* `DirectMessage`
* `TypingIndicator`
* `ReadReceipt`
  E só depois adiciona anexos/threads/mentions etc. sem quebrar contratos.

---

# 2.1 `core-messaging` — domínio canônico de mensagens diretas

## EPIC F2.1 — Definir e publicar o contrato canônico de DM (schemas + invariantes)

**Objetivo:** ter um pacote que vira “verdade única” para qualquer chat connector.

### F2.1.1 — Modelagem do domínio (schemas)

**Entregas**

* Tipos canônicos:

  * `DirectMessage`
  * `TypingIndicator`
  * `ReadReceipt`
* Estruturas auxiliares:

  * `ActorRef` (quem executou: user/page/phone/participant)
  * `ChannelRef` (whatsapp/instagram/messenger/… + account identifiers)
  * `ConversationRef` (provider thread id / chat id)
  * `MessageRef` (provider message id + client message id opcional)
  * `Attachment` (mínimo: type + url/id + mime + size, opcional nesta fase)
* Invariantes mínimos (exemplos práticos):

  * `DirectMessage.direction` ∈ `inbound|outbound`
  * `DirectMessage.externalMessageId` obrigatório quando `direction=inbound` (e recomendado outbound)
  * `ReadReceipt.externalMessageId` ou `ReadReceipt.conversationExternalId` (pelo menos um)
  * `timestamp` sempre em ISO ou epoch padronizado (defina 1)

**Critérios de aceite**

* Schemas validados (zod) e exportados como tipos TS.
* Um adapter consegue construir eventos sem “inventar campo”.

---

## EPIC F2.2 — Helpers canônicos: dedupeKey + normalização

**Objetivo:** reduzir duplicação e divergência entre adapters.

### F2.2.1 — Helpers de dedupeKey específicos

**Entregas**

* `makeMessagingDedupeKey({ channel, accountId, kind, externalId, subtype? })`
* Convenções recomendadas:

  * `dm:<channel>:<accountId>:msg:<externalMessageId>`
  * `dm:<channel>:<accountId>:typing:<conversationId>:<actorId>:<bucket>`
  * `dm:<channel>:<accountId>:read:<conversationId>:<messageId_or_bucket>`

**Nota dura:** `TypingIndicator` não é naturalmente idempotente (é “sinal”, não “evento”). Precisamos de **bucket/TTL** para dedupe e evitar flood. Ex.: bucket de 5–10s.

**Critérios de aceite**

* Todos adapters do projeto usam esses helpers.
* Existe teste unitário garantindo formato e estabilidade.

---

## EPIC F2.3 — Parser compartilhado “Meta DM” (Instagram + Messenger) como biblioteca

**Objetivo:** parar de repetir parsing de payload Meta em cada app.

### F2.3.1 — “Meta DM parser” compartilhado

**Entregas**

* `parseMetaDirectMessagingWebhook(body) => MessagingEvent[]`
* Coverage inicial:

  * Instagram DMs
  * Messenger DMs (mesma família de webhook changes; variações de campos)
* O parser retorna **eventos canônicos** (`DirectMessage`, `TypingIndicator`, `ReadReceipt`) e não `EventEnvelope` de runtime.

**Critérios de aceite**

* O app Instagram/Messenger só faz: verify signature + chamar parser + empacotar no runtime.

---

## EPIC F2.4 — Integração com o runtime/events do projeto (bridge)

**Objetivo:** encaixar o “domínio canônico” no pipeline atual de `ParsedEvent` + capabilities.

### F2.4.1 — Bridge `core-messaging` → `core-events`

**Entregas**

* Mapeamentos:

  * `DirectMessage` → capability `inbound_messages` / `outbound_messages` (dependendo direction)
  * `ReadReceipt` → `message_status_updates` OU um novo capability `read_receipts` (decisão)
  * `TypingIndicator` → capability `typing_indicators` (provável novo)
* Decisão:

  * `ReadReceipt` deve mapear para `message_status_updates` **se** o seu core já trata “read” como status de mensagem.
  * Se não, crie capability `read_receipts` para não contaminar status pipeline.

**Critérios de aceite**

* Um evento canônico percorre o runtime sem perdas (dedupe, handler, logs).

---

## EPIC F2.5 — Testes de contrato (golden fixtures)

**Objetivo:** travar o contrato para não quebrar conectores no futuro.

**Entregas**

* Fixtures canônicas (JSON) para:

  * DM inbound text
  * DM outbound text
  * Read receipt
  * Typing indicator
* Testes:

  * validação zod
  * estabilidade de dedupeKey
  * backward compatibility (se mudar schema, exige versão)

**Critérios de aceite**

* Qualquer PR que quebra contrato falha CI.

---

## Arquivos-alvo pro `core-messaging`

### Adicionar

* `packages/core-messaging/package.json`
* `packages/core-messaging/src/index.ts`
* `packages/core-messaging/src/schemas.ts`
* `packages/core-messaging/src/types.ts`
* `packages/core-messaging/src/dedupe.ts`
* `packages/core-messaging/src/meta/parseMetaDmWebhook.ts`
* `packages/core-messaging/tests/*.test.ts`
* `packages/core-messaging/tests/fixtures/*`

### Alterar (integração)

* `apps/instagram/src/app.ts` (passar a usar parser compartilhado, quando pronto)
* `apps/<messenger>/src/app.ts` (quando existir)
* `packages/core-runtime/src/index.ts` (apenas se precisar de novos capability handlers)

---

---

# 2.2 `core-reactions` — domínio canônico de engajamento

## EPIC F2.6 — Definir contrato canônico de reações (schemas + invariantes)

**Objetivo:** Reaction é “engajamento” aplicável a DM e comentários.

### F2.6.1 — Schemas canônicos

**Entregas**

* Eventos:

  * `Reaction`
  * `ReactionRemoved`
* Campos mínimos:

  * `target`: `{ kind: 'message'|'comment', externalId, conversationExternalId? }`
  * `actor`: `ActorRef`
  * `reactionType`: `{ kind: 'like'|'emoji'|'custom', value }`
  * `timestamp`
  * `channel`: `ChannelRef`

**Critérios de aceite**

* Mesmo schema serve para Instagram DM reactions, Messenger reactions e (futuro) comentários.

---

## EPIC F2.7 — Normalização de reactionType + mapeamento provider

**Objetivo:** padronizar o que é “like” vs “emoji” e não poluir analytics.

### F2.7.1 — Tabela de normalização

**Entregas**

* `normalizeReaction(provider, raw) -> reactionType`
* Regras:

  * “Like” vira `kind=like`
  * Emoji vira `kind=emoji, value='🔥'`
  * Valores desconhecidos viram `custom`

**Critérios de aceite**

* Dois providers diferentes com “like” convergem no mesmo tipo interno.

---

## EPIC F2.8 — Integração com comentários e mensagens (bridges)

**Objetivo:** ligar Reaction a entidades já normalizadas.

### F2.8.1 — Bridge `core-reactions` ↔ `core-comments` e `core-messaging`

**Entregas**

* Funções de enriquecimento opcional:

  * `linkReactionToMessage({ reaction, messageRef })`
  * `linkReactionToComment({ reaction, commentRef })`
* Convenção de dedupeKey:

  * `react:<channel>:<accountId>:<targetKind>:<targetId>:<actorId>:<reactionValue>`

**Critérios de aceite**

* Não duplica reação em retries.
* Remove (ReactionRemoved) casa com Reaction original por chave estável.

---

## EPIC F2.9 — Parser(s) provider → core-reactions

**Objetivo:** primeiro adapter Meta (Instagram/Messenger), depois outros.

**Entregas**

* `parseMetaReactionsWebhook(body) => ReactionEvent[]`
* Fixtures reais e testes

**Critérios de aceite**

* Um POST com múltiplas reações vira batch de eventos canônicos.

---

## Arquivos-alvo pro `core-reactions`

### Adicionar

* `packages/core-reactions/package.json`
* `packages/core-reactions/src/index.ts`
* `packages/core-reactions/src/schemas.ts`
* `packages/core-reactions/src/types.ts`
* `packages/core-reactions/src/normalize.ts`
* `packages/core-reactions/src/dedupe.ts`
* `packages/core-reactions/src/meta/parseMetaReactionsWebhook.ts`
* `packages/core-reactions/tests/*.test.ts`
* `packages/core-reactions/tests/fixtures/*`

### Alterar (integração)

* `packages/core-comments/src/*` (se quiser expor CommentRef/IDs canônicos)
* `apps/instagram/src/app.ts` (para consumir parser compartilhado quando implementar reactions)
* `packages/core-runtime/src/index.ts` (registrar novo capability: `reactions` / `reactions_removed`)

---

# Ordem de execução recomendada (Fase 2)

1. **F2.1** (schemas/invariantes de core-messaging)
2. **F2.2** (dedupe helpers + typing bucket)
3. **F2.4** (bridge com runtime/capabilities) — para não criar pacote “solto”
4. **F2.3** (parser Meta DM compartilhado) — já usa tudo acima
5. **F2.5** (contract tests + fixtures canônicas)
6. **F2.6** (schemas core-reactions)
7. **F2.7** (normalize rules)
8. **F2.8** (bridges com messaging/comments)
9. **F2.9** (parser Meta reactions + fixtures)

Se você começar por parser (F2.3/F2.9) sem contrato travado (F2.1/F2.6), você vai refatorar duas vezes. Não vale.

---

# Critérios “pronto” da Fase 2

* `core-messaging` exporta **schemas + types + dedupe helpers** e tem **fixtures canônicas**.
* Pelo menos 1 adapter (Meta DM) usa `core-messaging` sem duplicar lógica.
* `core-reactions` exporta contrato estável e pelo menos 1 parser/provider mapeia para ele.
* Runtime consegue processar esses eventos como batch (pré-requisito: Fase 1 F1.0).

---

# Fase 3 — Calendários (Integração Real) — Detalhada

## Decisões estruturais (bloqueantes)

### D3.0 — Separar 3 preocupações

1. **Auth** (OAuth2 + tokens)
2. **Ingest near-real-time** (watch/webhook)
3. **Sync engine** (initial + incremental + reconcile)

O watch **não substitui** sync. Ele só dispara “algo mudou”; o sync é quem garante consistência.

### D3.1 — Contrato canônico de calendário (um pacote core)

Antes de escrever Google/CalDAV, defina o contrato:

* `CalendarEvent` canônico
* eventos canônicos (`CalendarEventCreated/Updated/Deleted`)
* `CalendarRef` (provider + calendarId + accountId)
* `EventRef` (provider eventId + iCalUID quando existir)

Isso evita acoplamento no payload do Google.

### D3.2 — Idempotência por “evento + versão”

Google manda `etag`, `updated` e, em watch, você recebe só “tem mudança”. Idempotência deve ser:

* dedupeKey = `calendar:<provider>:<calendarId>:<eventId>:<etag|updated>` quando disponível
* fallback com `updated` + hash do payload normalizado

### D3.3 — Recorrência: MVP com regras claras

Recorrência é um poço sem fundo. Para **Fase 3**, faremos:

* **Suportar**: eventos recorrentes como “master event” + instances quando o Google entregar
* **Não expandir** tudo localmente por regra RRULE (fica para fase posterior)
* Tratar `status=cancelled` e `recurringEventId`

---

## 3.1 Google Calendar — primeiro conector real

## EPIC F3.0 — Contrato canônico de calendário (core-calendar)

**Objetivo:** base comum para Google e CalDAV.

### F3.0.1 — Schemas e tipos

**Entregas**

* `CalendarEvent` (canônico), com campos mínimos:

  * `externalEventId`, `iCalUID?`, `etag?`, `updatedAt`, `status` (`confirmed|cancelled|tentative`)
  * `title`, `description?`, `location?`
  * `start`, `end` (datetime + timezone; all-day suportado)
  * `attendees?` (emails + responseStatus)
  * `organizer?`
  * `recurrence?` (string[] RRULE/EXDATE como raw)
  * `recurringEventId?` (instance linking)
* Eventos canônicos:

  * `CalendarEventCreated`
  * `CalendarEventUpdated`
  * `CalendarEventDeleted`

### F3.0.2 — Helpers

* `makeCalendarDedupeKey(...)`
* normalização de datas/timezone
* normalização de all-day

**Critérios de aceite**

* Schemas (zod) + fixtures canônicas + tests de compat.

**Arquivos-alvo**

* `packages/core-calendar/*` (novo)

---

## EPIC F3.1 — OAuth2 completo Google (scopes mínimos) + TokenStorage por tenant

**Objetivo:** autenticação robusta e sustentável.

### F3.1.1 — Scopes mínimos (decisão)

* Se o produto é “espelhar agenda”: `.../auth/calendar.readonly`
* Se vai criar/editar eventos: `.../auth/calendar.events` (ou `calendar` completo)
  Recomendação: **comece com read-only** para espelhamento e reduza risco de permissão.

### F3.1.2 — Implementar fluxo OAuth no app Google Calendar

**Entregas**

* Rotas:

  * `GET /oauth/start` (gera URL)
  * `GET /oauth/callback` (exchange code)
* Persistir tokens no `TokenStorage` (ideal: RedisTokenStorage já planejado na Fase 2/1)
* `TokenManager.getValidAccessToken()` com refresh automático

### F3.1.3 — Multi-tenant e múltiplas contas

* chave de storage: `tenantId + providerAccountId (+ calendarId opcional)`
* suportar múltiplas integrações por tenant (várias agendas/contas)

**Critérios de aceite**

* token refresh automático funcionando em testes (simulado).
* revogação/401 vira “integration unhealthy” (não loop infinito).

**Arquivos-alvo**

* `apps/calendar-google/src/routes/oauth.ts` (novo)
* `packages/core-auth/*` (se ainda faltar algo do OAuth)

---

## EPIC F3.2 — Webhooks Google (watch/renew/stop) + assinatura + segurança

**Objetivo:** near-real-time trigger confiável.

### F3.2.1 — Criar watch channels por calendar

**Entregas**

* endpoint para iniciar watch:

  * cria `channelId` (UUID)
  * define `address` (webhook URL)
  * define `token` (secret) para validação de origem
* armazenar channel:

  * `channelId`, `resourceId`, `expiration`, `calendarId`, `tenantId`, `accountId`

### F3.2.2 — Webhook receiver (notifications)

Google envia headers (ex.: `X-Goog-Channel-ID`, `X-Goog-Resource-ID`, `X-Goog-Resource-State`, etc.). O payload costuma ser vazio; o valor é o header.

**Entregas**

* validar:

  * channel existe
  * resourceId bate
  * token bate
* transformar notificação em **evento interno**: `CalendarSyncRequested` (novo)

  * isso evita fazer sync pesado dentro do request do webhook

### F3.2.3 — Renew de watch (scheduler)

Watch expira. Você precisa de renovação automática:

* job recorrente que:

  * lista channels próximos de expirar
  * renova watch
  * atualiza storage
* se falhar, marca integração “degradada” e tenta de novo com backoff

**Critérios de aceite**

* watch é criado e renovado antes de expirar.
* webhook inválido não dispara sync.

**Arquivos-alvo**

* `packages/core-calendar-watch/*` ou dentro do `apps/calendar-google`
* `packages/core-automations` (se já existir scheduler infra) ou criar `apps/automation` job específico

---

## EPIC F3.3 — `core-sync`: sync inicial + incremental + reconcile

**Objetivo:** consistência do espelho.

### F3.3.1 — Contrato do sync engine

**Entregas**

* `SyncCursor` (por calendar):

  * `nextSyncToken?`
  * `lastFullSyncAt`
  * `lastIncrementalSyncAt`
  * `stateVersion`
* API do sync:

  * `runInitialSync(calendarRef)`
  * `runIncrementalSync(calendarRef)`
  * `reconcile(calendarRef)` (quando token invalida ou drift detectado)

### F3.3.2 — Implementar Google incremental sync corretamente

Google Calendar API suporta `syncToken` e `nextSyncToken`. Regras:

* initial: list paginado → `nextSyncToken`
* incremental: list com `syncToken` → delta
* se receber erro “sync token invalid/expired” → fallback para full resync

### F3.3.3 — Persistência do espelho (storage)

Você precisa armazenar “espelho” em algum lugar (mesmo que temporário):

* `CalendarEventMirror` store:

  * `tenantId`, `calendarId`, `externalEventId`, `etag`, `updatedAt`, `hash`, `payloadNormalized`
    Opções:
* Redis (rápido, mas TTL e durabilidade limitada)
* Postgres (ideal para produção)
  Como o projeto “connectors” provavelmente está isolado, defina uma interface:
* `CalendarMirrorStore` + implementação `RedisCalendarMirrorStore` (MVP)
* Depois, pluga Postgres sem refatorar sync.

### F3.3.4 — Emissão de eventos Created/Updated/Deleted

O sync engine compara:

* não existe no mirror → Created
* existe e mudou (etag/hash) → Updated
* item removido/cancelled → Deleted

**Critérios de aceite**

* Initial sync cria mirror e emite Created sem duplicar.
* Incremental emite apenas diffs reais.
* token inválido → resync automático e consistente.

**Arquivos-alvo**

* `packages/core-sync/*` (novo)
* `packages/core-calendar/*` (usa os schemas)
* `apps/calendar-google/src/sync/*` (adapter Google chamando core-sync)

---

## EPIC F3.4 — App Google Calendar: conector runtime (webhook + commands + sync worker)

**Objetivo:** conector operacional.

### F3.4.1 — App scaffold real

**Entregas**

* `apps/calendar-google/src/app.ts`

  * endpoints:

    * `/webhook` (receber notifications)
    * `/oauth/*` (fase auth)
    * `/health`
* manifesto de capabilities:

  * `calendar_webhooks` (inbound)
  * `calendar_sync` (worker/internal)
  * opcional: `calendar_outbound` (criar/atualizar eventos) — fora do MVP se read-only

### F3.4.2 — Worker de sync

Não rode sync pesado no webhook.

* webhook → emite `CalendarSyncRequested`
* worker consome isso e chama `core-sync`

**Critérios de aceite**

* webhook responde rápido (sub-200ms em local) e não depende da API do Google para responder 200.
* sync roda assíncrono e tolera falhas (retry/backoff).

**Arquivos-alvo**

* `apps/calendar-google/src/worker.ts` (novo) ou integrar em app existente de automations

---

## EPIC F3.5 — Observabilidade + runbook + testes de integração

**Objetivo:** operar sem “mistério”.

### F3.5.1 — Logs e métricas

* `calendar_watch_created_total`
* `calendar_watch_renewed_total`
* `calendar_sync_full_total`
* `calendar_sync_incremental_total`
* `calendar_events_created/updated/deleted_total`
* latência por sync run
* erros por status code do Google

### F3.5.2 — Testes

* Unitários:

  * mapping Google → `CalendarEvent`
  * dedupeKey
  * sync diff engine
* Integração (mock HTTP):

  * simular Google list pages
  * simular incremental com syncToken
  * simular token inválido → full sync

**Critérios de aceite**

* Você consegue provar “espelho consistente” com testes determinísticos.

---

## Ordem de execução recomendada (Fase 3)

1. **F3.0 core-calendar** (contrato + schemas)
2. **F3.3 core-sync (diff engine + cursor + store interface)**
3. **F3.1 OAuth Google** (para conseguir tokens)
4. **F3.2 Watch/webhook/renew** (gatilhos)
5. **F3.4 App + worker (orquestração)**
6. **F3.5 Observabilidade + runbook + testes integração**

Se começarmos por watch sem core-sync, vai ter “notificações” que não resultam em consistência. É teatro.

---

# 3.2 Apple Calendar / CalDAV (opcional) — versão rica

## EPIC F3.6 — Adapter CalDAV + parsing ICS → core-calendar

**Objetivo:** compatibilidade enterprise sem mudar o domínio.

### F3.6.1 — Auth CalDAV

* Basic auth / app-specific password (Apple) ou OAuth (alguns provedores)
* storage por tenant e account

### F3.6.2 — Discover + Sync

* discovery de calendars via CalDAV
* sync via `REPORT` (calendar-query) com `sync-token` (quando servidor suporta)
* fallback: ETag/CTag + full list

### F3.6.3 — ICS parsing

* parse VEVENT → `CalendarEvent` canônico
* mapear:

  * UID → `iCalUID`
  * DTSTART/DTEND/all-day
  * RRULE/EXDATE (raw)
  * STATUS/CANCELLED

**Critérios de aceite**

* Mesmo core-sync funciona, mudando apenas o adapter.

**Arquivos-alvo**

* `packages/core-caldav/*` (novo)
* `apps/calendar-caldav/*` (novo, opcional)

---

# Arquivos-alvo (resumo do que você provavelmente será criado (minimamente))

### Novos packages

* `packages/core-calendar/*`
* `packages/core-sync/*`
* (opcional) `packages/core-google-calendar/*` (client + mapping)
* (opcional) `packages/core-caldav/*`

### Novo app

* `apps/calendar-google/*`
* (opcional) `apps/calendar-caldav/*`

### Pacotes existentes que serão estendidos

* `packages/core-auth/*` (se ainda faltar OAuth robusto/TokenStorage)
* `packages/core-http/*` (se não tiver client HTTP com retry/timeout)
* `packages/core-runtime/*` (capabilities/handlers, se necessário)

---

# Critérios “pronto” da Fase 3

* Consegue **initial sync** e depois **incremental** mantendo um mirror consistente.
* Watch/webhook não causa duplicação e não é dependência única (se cair, sync recupera).
* Token inválido/expirado é tratado com refresh + fallback para full resync quando necessário.
* Eventos Created/Updated/Deleted são emitidos com dedupe e correlação por item.

---

# Fase 4 — Automação / iPaaS — versão rica

## Decisões estruturais (bloqueantes)

### D4.0 — Separar “Outbound triggers” de “Inbound actions”

* **Triggers (Outbound):** você emite eventos do seu sistema para plataformas externas (Zapier/Make).
* **Actions (Inbound):** a plataforma externa chama você para executar comandos normalizados.

Misturar isso gera caos de segurança e rastreabilidade.

### D4.1 — Contrato de automação canônico (core-automation)

Você precisa de um domínio interno, independente de Zapier/Make:

* `AutomationTriggerPayload` (derivado de `EventEnvelope`, mas filtrado/PII-safe)
* `AutomationActionCommand` (comandos normalizados + validação)
* `AutomationExecutionResult` (status, logs, error codes)

### D4.2 — Segurança e multi-tenant NÃO É OPCIONAL

* Todo trigger/action deve carregar:

  * `tenantId` (interno)
  * `integrationId` (qual conexão Zapier/Make)
  * `signature` ou token forte
* Nunca expor `tenantId` cru; usar `integrationId` + secret.

### D4.3 — Idempotência é requisito de plataforma

Zapier/Make fazem retry. Nós precisamos:

* `Idempotency-Key` em actions (aceitar header)
* dedupe store por `(integrationId, idempotencyKey)` com TTL adequado
* para triggers: “at least once” com dedupe do lado deles, mas você deve evitar spam com replay control e rate limit.

### D4.4 — PII/segredos: payloads “safe by default”

Vamos vazar dados se mandar `EventEnvelope` bruto. Defina um **Data Contract Sanitizer**:

* allowlist de campos por evento/capability
* mascaramento (ex.: telefone/email parcialmente)
* “expand” opcional via action autenticada

---

## 4.1 Zapier — integração com ecossistema externo

## EPIC F4.0 — `core-automation`: contratos, sanitização, idempotência, audit

**Objetivo:** base única para Zapier + Make + futuros.

### F4.0.1 — Contratos canônicos

**Entregas**

* `AutomationTriggerEvent` (id, type, occurredAt, payload, cursor/sequence, metadata)
* `AutomationActionCommand` (type, inputs, correlationId, idempotencyKey)
* `AutomationExecutionResult` (ok, errorCode, providerRef?, logs?, outputs?)

### F4.0.2 — Sanitização (PII-safe)

**Entregas**

* `sanitizeEventEnvelopeToAutomationPayload(envelope, policy)`:

  * policy por evento/capability: allowlist
  * remove/mascara PII por default
* Testes garantindo que campos proibidos não vazam

### F4.0.3 — Audit trail

**Entregas**

* `AutomationAuditRecord`:

  * integrationId, triggerId/actionId, dedupeKey, status, timestamps, retries, errorCode
* Interface `AutomationAuditStore` (Redis Mínimo; Postgres ideal)

**Critérios de aceite**

* Você consegue responder: “qual automação disparou este comando?” com correlationId.

**Arquivos-alvo**

* `packages/core-automation/*` (novo)
* `packages/core-audit/*` (se já existir; senão, incluir no core-automation)

---

## EPIC F4.1 — Zapier: Auth (API key / OAuth) + conexão por tenant

**Objetivo:** autenticação segura e revogável.

### F4.1.1 — Modelo de autenticação (decisão)

* **MVP:** API Key por integração (mais simples)
* **Futuro:** OAuth (melhor UX, mais complexo)

Recomendação: **API Key no MVP**, mas arquitetar para plugar OAuth depois.

### F4.1.2 — Provisionamento de “Zapier Connection”

**Entregas**

* endpoint interno/admin para criar integração:

  * gera `integrationId`
  * gera `secret` (API key)
  * configura quais eventos estão habilitados (scope)
* storage: `IntegrationStore` (tenant scoped)
* revogação/rotação de secret

**Critérios de aceite**

* Um tenant pode ter várias integrações Zapier, cada uma com scopes próprios.
* Rotacionar secret invalida chamadas antigas.

**Arquivos-alvo**

* `packages/core-integrations/*` (se não existir, criar)
* `apps/automation-zapier/src/routes/auth.ts` (ou dentro de um `apps/automations` geral)

---

## EPIC F4.2 — Zapier Triggers (Outbound) baseados em EventEnvelope (sanitizado)

**Objetivo:** publicar triggers consumíveis no Zapier.

### F4.2.1 — Trigger Router (EventEnvelope → deliveries)

**Entregas**

* Consumidor interno de `EventEnvelope` (ou do bus interno) que:

  * aplica `sanitize`
  * aplica filtros por integration scope
  * entrega via webhook para Zapier (REST hook) ou “polling triggers” (depende do modelo Zapier escolhido)

**Nota:** Zapier suporta diferentes modelos: “REST Hook trigger” (Zapier chama um endpoint seu para registrar um hook e você envia eventos), ou polling (Zapier puxa). Para produção, REST Hook costuma ser melhor.

### F4.2.2 — Retry/backoff e DLQ

**Entregas**

* delivery com retry (429/5xx/timeouts) e backoff
* DLQ (fila de falhas) com “replay” manual
* dedupe de deliveries por `(integrationId, triggerEventId)`

**Critérios de aceite**

* At-least-once sem spam (dedupe na sua borda).
* Se Zapier cair 1h, backlog reprocessa sem duplicar.

**Arquivos-alvo**

* `apps/automation-zapier/src/delivery/*`
* `packages/core-delivery/*` (se genérico fizer sentido)

---

## EPIC F4.3 — Zapier Actions (Inbound) baseadas em comandos normalizados

**Objetivo:** Zapier chama você e você executa no core.

### F4.3.1 — Endpoint de actions + validação

**Entregas**

* `POST /zapier/actions/:actionType`

  * auth via API key header
  * valida payload (zod)
  * extrai idempotencyKey
  * executa command handler interno
  * retorna `AutomationExecutionResult`

### F4.3.2 — Catálogo mínimo de actions (MVP)

Você precisa escolher ações que fazem sentido transversalmente:

* `CreateLead`
* `UpdateLead`
* `CreateTask`
* `SendDirectMessage` (se já existe core-messaging/outbound)
* `CreateCalendarEvent` (se Fase 3 read-write for adotada; senão, skip)

**Critérios de aceite**

* Actions idempotentes: 3 retries resultam em 1 execução.
* Erros retornam codes estáveis (ex.: `VALIDATION_FAILED`, `RATE_LIMITED`, `UPSTREAM_ERROR`).

**Arquivos-alvo**

* `apps/automation-zapier/src/routes/actions.ts`
* `packages/core-automation/src/actions/*`

---

## EPIC F4.4 — Zapier Developer Experience (DX): app definition + docs + examples

**Objetivo:** reduzir suporte e aumentar adoção.

### F4.4.1 — Zapier app spec (CLI)

**Entregas**

* Repositório interno ou pasta:

  * `apps/automation-zapier/zapier-app/*` (JS/TS)
* Define:

  * triggers (listados)
  * actions (listadas)
  * auth (API key)
* Exemplos de payload e testes de handshake

### F4.4.2 — Documentação e exemplos

**Entregas**

* `docs/zapier.md` com:

  * como criar integração
  * como configurar triggers e actions
  * exemplos de payload
  * troubleshooting (401, 429, retries)

**Critérios de aceite**

* Um terceiro integra em < 30 minutos seguindo doc, sem você no meio.

---

# 4.2 Make (Integromat) — alternativa avançada

A diferença prática do Make é que ele é mais flexível e “webhook-first”, mas também mais propenso a cenários mal configurados. Nosso design deve conter blast radius.

## EPIC F4.5 — Make: Webhooks bidirecionais + templates

**Objetivo:** Make como hub avançado.

### F4.5.1 — Inbound webhooks (actions)

**Entregas**

* Endpoint(s) Make para actions:

  * `POST /make/hooks/:hookId`
* auth e idempotência iguais Zapier
* resposta padronizada

### F4.5.2 — Outbound webhooks (triggers)

**Entregas**

* Registrar um webhook Make por cenário:

  * `hookId`, secret, scopes, filtros
* Deliveries iguais Zapier

### F4.5.3 — Templates de cenários

**Entregas**

* templates JSON/export do Make para:

  * “WhatsApp message received → Create lead in CRM”
  * “Lead created → Send Slack/Email” (exemplo)
* documentação com prints/steps

**Critérios de aceite**

* Você fornece 3–5 templates que “vendem” o produto.

**Arquivos-alvo**

* `apps/automation-make/*` (novo) ou integrar em um app único `apps/automation/*`
* `docs/make.md`
* `docs/templates/make/*`

---

# Governança e custos (tem que entrar na Fase 4, não depois)

## EPIC F4.6 — Rate limits, quotas e proteção de abuso

**Objetivo:** evitar que integrações detonem seu runtime.

**Entregas**

* Rate limit por:

  * integrationId
  * tenantId
  * actionType
* Quotas configuráveis
* “circuit breaker” (desabilitar integração automaticamente após N falhas)

**Critérios de aceite**

* Integração mal configurada não derruba o sistema inteiro.

**Arquivos-alvo**

* `packages/core-rate-limit/*` (já existe; extender)
* `packages/core-automation/*` (aplicar)

---

# Ordem de execução recomendada (Fase 4)

1. **F4.0 core-automation** (contratos + sanitização + audit)
2. **F4.1 Auth + IntegrationStore** (sem isso, tudo vira gambiarra insegura)
3. **F4.3 Actions inbound** (mais rápido de provar valor e exercita idempotência)
4. **F4.2 Triggers outbound** (entrega de eventos com retry/DLQ)
5. **F4.6 Governança (rate limits/quotas/circuit breaker)**
6. **F4.4 Zapier DX** (app spec + docs)
7. **F4.5 Make** (aproveita o mesmo core; só muda “embalagem” e templates)

---

# Arquivos-alvo (resumo)

### Novos packages

* `packages/core-automation/*`
* `packages/core-integrations/*` (se não existir)
* (opcional) `packages/core-delivery/*` (delivery genérico ou definir um específico - o que fizer mais sentido)
* (opcional) `packages/core-audit/*` (ou dentro do core-automation)

### Novos apps (recomendação pragmática)

* `apps/automation-zapier/*`
* `apps/automation-make/*`
  Ou um único:
* `apps/automation/*` com rotas `/zapier/*` e `/make/*`

### Docs

* `docs/zapier.md`
* `docs/make.md`
* `docs/automation-security.md`
* `docs/templates/make/*`

---

# Critérios “pronto” da Fase 4

* Inbound actions idempotentes (retries não duplicam).
* Outbound triggers at-least-once com dedupe e DLQ.
* Payloads sanitizados (PII-safe) por policy.
* Integrações isoladas por tenant, com rotação/revogação de secret.
* Rate limits e circuit breaker impedem abuso.
* Docs permitem integração sem suporte manual.

---

# Fase 5 — Outros Canais de Mensageria - Detalhada

## Escopo e hierarquia de provedores (fixa)

**Ordem de prioridade (não negociável):**

1. **Default:** Amazon SES (100% controlado pela Pyloto)
2. **Premium:** SendGrid
3. **Avançado:** Mailgun
4. **Fallback:** SMTP genérico (modo expert / último recurso)

**Princípios inegociáveis (aplicados a todos):**

* SES **nunca** é exposto diretamente ao usuário final
* Todo envio é **isolado por tenant**
* Logs, auditoria e correlação obrigatórios
* Rate limit por organização
* Templates versionados no CRM (não no conector)
* Webhooks obrigatórios: bounce, spam, delivery
* **DMARC, SPF e DKIM como baseline**, não opcional

---

## Decisões estruturais (bloqueantes)

### D5.0 — E-mail é domínio próprio (`core-email`)

E-mail **não é DM**. Ele tem:

* headers
* subject/thread
* delivery lifecycle (bounce, spam, delivered)
* reputação e compliance (DMARC)

Misturar isso com `core-messaging` seria erro estrutural.
**Decisão:** criar e usar `core-email` como domínio canônico.

---

### D5.1 — Provider ≠ Canal

O canal é **Email**.
SES, SendGrid, Mailgun e SMTP são **providers intercambiáveis** atrás de uma mesma interface:

```
SendEmailCommand
      ↓
core-email (contrato + validações)
      ↓
EmailProviderAdapter (SES | SendGrid | Mailgun | SMTP)
```

O tenant **não escolhe API**, escolhe **plano**.
O sistema resolve o provider.

---

### D5.2 — Templates são ativos do CRM, não do conector

* Conectores **nunca** renderizam template
* Eles recebem:

  * HTML final
  * text/plain
  * metadata de template (id, versão)
* Versionamento e rollback vivem no CRM

---

### D5.3 — Reputação é um recurso compartilhado e deve ser protegida

* SES default opera com **domínios controlados pela Pyloto**
* Premium/Avançado usam domínios dedicados por tenant
* Fallback SMTP **não recebe garantias de deliverability**

---

# 5.1 Facebook Messenger (Meta) — reuso direto de `core-messaging`

*(Messenger permanece praticamente igual ao que já foi definido, apenas consolidado aqui)*

## EPIC F5.1 — Messenger DM inbound/outbound + status

**Objetivo:** canal Meta adicional sem duplicar stack.

### Entregáveis

* DM inbound/outbound
* Read receipts / typing indicators
* Reuso direto de:

  * `core-messaging`
  * parser Meta DM compartilhado
  * retry/backoff + dedupe

### Critérios de conclusão

* Nenhuma lógica de parsing duplicada no app
* Messenger se comporta igual ao Instagram/WhatsApp no pipeline

---

# 5.2 E-mail — canal complementar (com providers definidos)

## EPIC F5.2 — `core-email`: domínio canônico de e-mail

### Objetivo

Criar o contrato único e imutável de e-mail dentro do ecossistema Pyloto.

### Entregáveis

#### Schemas canônicos

* `EmailMessage`

  * `externalMessageId`
  * `rfcMessageId` (Message-ID)
  * `threadId?`
  * `from`
  * `to[]`, `cc[]`, `bcc[]`
  * `subject`
  * `textBody?`
  * `htmlBody?`
  * `attachmentsMeta[]` (nunca binário)
  * `sentAt`, `receivedAt?`
  * `provider`
  * `tenantId`

#### Eventos

* `EmailSent`
* `EmailReceived`
* `EmailDelivered`
* `EmailBounced`
* `EmailMarkedAsSpam`

#### Helpers

* dedupe inbound:

  ```
  email:<provider>:<tenant>:in:<rfcMessageId>
  ```
* dedupe outbound:

  ```
  email:<provider>:<tenant>:out:<clientMessageId>
  ```

### Critério de conclusão

* Fixtures canônicas
* Zod schemas
* Tests travando contrato

---

## EPIC F5.3 — Provider adapters (SES / SendGrid / Mailgun / SMTP)

### Objetivo

Permitir múltiplos providers sem mudar o core.

### Interface única

```ts
interface EmailProviderAdapter {
  send(command: SendEmailCommand): ProviderResult
  healthCheck(): ProviderHealth
}
```

---

### F5.3.1 Amazon SES (Default)

**Características**

* 100% controlado pela Pyloto
* Domínio padrão Pyloto (ex.: `mail.pyloto.com`)
* Sub-addressing por tenant (`tenant+id@mail.pyloto.com`)

**Entregáveis**

* Adapter SES
* Configuração:

  * DKIM
  * SPF
  * DMARC (p=quarantine ou reject)
* Rate limit interno por tenant
* Webhooks:

  * Bounce
  * Complaint (spam)
  * Delivery

**Critério**

* Nenhum tenant acessa SES diretamente
* Reputação protegida por limites e auditoria

---

### F5.3.2 SendGrid (Premium)

**Características**

* Domínio dedicado por tenant
* Melhor UX para clientes enterprise

**Entregáveis**

* Adapter SendGrid
* Mapeamento de eventos:

  * delivered
  * bounced
  * spam_report
* Integração com `core-email` events

---

### F5.3.3 Mailgun (Avançado)

**Características**

* Casos avançados (routing, inbound complexo)
* Tenant com domínio próprio

**Entregáveis**

* Adapter Mailgun
* Parsing de inbound avançado
* Eventos completos de lifecycle

---

### F5.3.4 SMTP genérico (Fallback / Expert)

**Características**

* Sem garantias
* Apenas para clientes que sabem o que estão fazendo

**Entregáveis**

* Adapter SMTP
* Limites mais agressivos
* Flags de risco no audit log

---

## EPIC F5.4 — Inbound e-mail (webhooks)

### Objetivo

Normalizar inbound independentemente do provider.

### Entregáveis

* Webhook receiver por provider
* Validação de assinatura/token
* Parsing para `EmailReceived`
* Attachment metadata apenas

### Critério

* Webhook inválido não entra
* Repetição não duplica evento

---

## EPIC F5.5 — Governança, auditoria e reputação

### Objetivo

Evitar spam, abuso e incidentes de deliverability.

### Entregáveis

* Rate limit:

  * por tenant
  * por domínio
  * por destinatário
* Quotas diárias
* Circuit breaker automático:

  * muitos bounces
  * spam complaints
* `EmailAuditRecord`:

  * provider
  * tenant
  * templateId/version
  * status final
  * timestamps
  * correlationId

---

## EPIC F5.6 — Templates versionados no CRM (integração)

### Objetivo

Garantir controle e rastreabilidade.

### Entregáveis

* Conector recebe:

  * `templateId`
  * `templateVersion`
  * HTML/text já renderizados
* Logs sempre incluem template metadata
* Possibilidade de rollback no CRM sem mexer no conector

---

## Ordem de execução (Fase 5)

1. **F5.2 core-email (contrato + eventos + dedupe)**
2. **F5.3 Adapter SES (default)**
3. **F5.4 Inbound SES (bounce/spam/delivery)**
4. **F5.5 Governança + rate limits**
5. **F5.6 Integração com templates do CRM**
6. **F5.3.2 SendGrid**
7. **F5.3.3 Mailgun**
8. **F5.3.4 SMTP fallback**

---

## Arquivos-alvo (resumo)

### Novos packages

* `packages/core-email/*`
* `packages/core-email-providers/*`

  * `ses/*`
  * `sendgrid/*`
  * `mailgun/*`
  * `smtp/*`

### Novos apps

* `apps/email/*`
* `apps/messenger/*` (se ainda não existir)

### Pacotes reutilizados

* `packages/core-runtime`
* `packages/core-http`
* `packages/core-rate-limit`
* `packages/core-automation` (se actions forem expostas)
* `packages/core-audit`

---

## Critérios finais de “pronto” da Fase 5

### Messenger

* Funciona como qualquer outro canal Meta
* Usa `core-messaging` sem exceção

### E-mail

* SES como default isolado e seguro
* Providers intercambiáveis
* Templates versionados
* Webhooks completos (delivery lifecycle)
* DMARC ativo por padrão
* Nenhum tenant consegue comprometer reputação global

---

Vamos. E aqui eu vou ser especialmente incisivo: “Hardening & Produção” costuma virar uma fase eterna e difusa porque ninguém define **SLOs**, **gates de release** e **runbooks**. Se você não transformar isso em entregáveis objetivos, você nunca “termina”, e pior: não sabe quando está seguro o suficiente para crescer tráfego.

Abaixo está a **Fase 6 enriquecida** com: **Issue tree**, **ordem**, **arquivos-alvo**, **SLOs/gates**, e **critérios de aceite**.

---

# Fase 6 — Hardening & Produção - Detalhada

## Decisões estruturais (bloqueantes)

### D6.0 — Produção exige SLO + Error Budget

Sem SLO, observabilidade é vanity. Defina SLOs mínimos por categoria:

**Webhooks**

* Disponibilidade: ≥ 99,9% (responder 2xx)
* P95 latência do endpoint webhook: ≤ 200ms (sem sync pesado)
* Taxa de 5xx: ≤ 0,1%

**Processamento**

* Taxa de dedupe “esperada” varia, mas:

  * dedupe hit rate monitorado por conector/capability
* Erros de handler:

  * P95 retry success ≤ 3 tentativas para transitórios

**Outbound (mensagens/email)**

* Taxa de falha permanente ≤ X% (depende do canal, mas monitorar)
* 429 e rate-limit events por tenant monitorados

### D6.1 — “Release gates” automatizados

Nenhum conector sobe para produção (ou sai de “beta”) sem:

* testes passarem
* cobertura mínima de fixtures reais
* load test básico
* runbook e dashboards prontos
* política de secrets e rotação definida

### D6.2 — Auditoria é um produto de segurança, não log

Audit trail deve ser:

* imutável (append-only)
* tenant scoped
* consultável por correlationId/eventId
* com retenção definida

---

# 6.1 Observabilidade

## EPIC F6.1 — Telemetria padronizada (logs + métricas + tracing)

**Objetivo:** enxergar comportamento por conector, capability e tenant.

### F6.1.1 — Contrato de logs estruturados (obrigatório)

**Entregas**

* Um “schema” de log comum:

  * `timestamp`, `level`, `service`, `connector`, `version`
  * `correlationId`, `requestId`
  * `tenantId?`, `integrationId?`
  * `capabilityId`, `eventType`
  * `dedupeKey`, `dedupeHit`
  * `latencyMs`
  * `errorCode?`, `upstreamStatus?`
* Sanitização:

  * nunca logar payload bruto
  * mascarar PII (telefone/email)

**Critérios de aceite**

* Você consegue filtrar “tudo que aconteceu” com `correlationId`.
* Você consegue agrupar erros por `errorCode` e `upstreamStatus`.

**Arquivos-alvo**

* `packages/core-logging/*` (ou consolidar se já existe)
* `packages/core-runtime/src/index.ts` (emitir logs por item)

---

### F6.1.2 — Métricas mínimas por conector/capability

**Entregas**

* counters:

  * `webhook_requests_total{connector,capability}`
  * `webhook_request_errors_total{connector,status}`
  * `events_processed_total{connector,capability}`
  * `events_deduped_total{connector,capability}`
  * `events_failed_total{connector,capability,errorCode}`
  * `outbound_requests_total{connector,provider}`
  * `outbound_failures_total{connector,provider,errorCode}`
* histograms:

  * `webhook_latency_ms{connector}`
  * `handler_latency_ms{connector,capability}`
  * `outbound_latency_ms{connector,provider}`

**Implementação pragmática**

* Se não tiver Prometheus/OpenTelemetry ainda:

  * emitir métricas como logs (log-based metrics)
  * mas com formato padronizado para fácil ingest posterior

**Critérios de aceite**

* dashboard consegue mostrar: latência, erro, dedupe, throughput por conector.

**Arquivos-alvo**

* `packages/core-metrics/*` (novo ou já existente)
* `packages/core-runtime/*` (instrumentação)

---

### F6.1.3 — Tracing / correlação (mínimo viável)

**Entregas**

* `correlationId` gerado por request e propagado por item/evento
* `spanId` opcional (se você já estiver em OTel)

**Critérios de aceite**

* Uma execução outbound pode ser ligada ao inbound que a gerou (quando aplicável).

---

## EPIC F6.2 — Dashboards e Runbooks (operacional)

**Objetivo:** reduzir MTTR e suporte.

### F6.2.1 — Runbooks por conector

**Entregas**

* `docs/runbooks/whatsapp.md`
* `docs/runbooks/instagram.md`
* `docs/runbooks/messenger.md`
* `docs/runbooks/email.md`
* `docs/runbooks/calendar.md`
  Cada runbook deve ter:
* sintomas
* diagnóstico via logs/métricas
* ações de mitigação
* “quando escalar” e para quem

### F6.2.2 — Alertas (SLO-based)

**Entregas**

* alertas para:

  * 5xx acima de threshold
  * webhook latency p95 acima do SLO
  * fila/DLQ crescendo
  * spike de dedupe (indica retry storm)
  * spikes de 401/403 (token expirado ou revogado)

**Critérios de aceite**

* Você detecta incidentes antes do cliente reclamar.

---

# 6.2 Segurança

## EPIC F6.3 — Secrets management + rotação

**Objetivo:** eliminar segredos estáticos e reduzir blast radius.

### F6.3.1 — Inventário e classificação de segredos

**Entregas**

* lista por conector:

  * Meta app secret
  * Google OAuth client secret
  * SES/SendGrid/Mailgun keys
  * webhook signing secrets
* classificação:

  * “rotacionável automático”
  * “rotacionável manual”
  * “necessita downtime” (evitar)

### F6.3.2 — Rotação suportada pelo código

**Entregas**

* suporte a múltiplos secrets válidos simultaneamente (grace period):

  * ex.: validar assinatura contra `secret_current` e `secret_previous`
* endpoints/admin internos (ou scripts) para rotação:

  * gerar novo secret
  * habilitar em paralelo
  * desabilitar antigo após janela

**Critérios de aceite**

* Rotacionar não quebra webhooks nem outbound.

**Arquivos-alvo**

* `packages/core-auth/*`
* `packages/core-webhooks/*` (validação assinatura)
* `docs/security/secrets-rotation.md`

---

## EPIC F6.4 — Rate limiting e quotas por tenant (end-to-end)

**Objetivo:** impedir abuso e proteger reputação/custos.

### F6.4.1 — Rate limit em 3 camadas

1. Webhook ingress (proteção contra floods)
2. Processamento por capability
3. Outbound por provider (Email/Meta)

### F6.4.2 — Quotas + circuit breaker automático

**Entregas**

* limites por tenant:

  * msgs/min
  * emails/dia
  * actions/min (Zapier/Make)
* circuit breaker:

  * spam/bounce alto (email)
  * 429 persistente (Meta)
  * erro 401 repetido (OAuth inválido)

**Critérios de aceite**

* Um tenant não derruba o cluster e não compromete reputação do SES.

**Arquivos-alvo**

* `packages/core-rate-limit/*` (extender)
* `packages/core-dedupe/*`
* `packages/core-automation/*` (se já existir)

---

## EPIC F6.5 — Auditoria de eventos sensíveis (com retenção)

**Objetivo:** trilha para compliance e forense.

### F6.5.1 — Definir “eventos sensíveis”

Exemplos:

* envio outbound (mensagem/email)
* rotação de secrets
* criação/remoção de integrações
* export de dados
* mudança de template versionado

### F6.5.2 — Audit store e retenção

**Entregas**

* `AuditRecord` append-only com:

  * actor, tenantId, action, target, timestamps
  * correlationId/dedupeKey
  * resultado e errorCode
* retenção configurável (ex.: 90d / 180d)

**Critérios de aceite**

* Dado um incidente, você reconstrói a sequência.

**Arquivos-alvo**

* `packages/core-audit/*` (novo ou consolidar)
* `docs/security/audit.md`

---

# 6.3 Testes avançados

## EPIC F6.6 — Chaos testing (webhook retries + falhas transitórias)

**Objetivo:** provar resiliência do runtime.

### F6.6.1 — Simulador de retries e duplicações

**Entregas**

* harness que:

  * dispara o mesmo webhook N vezes
  * randomiza delays
  * injeta falhas 429/5xx
  * valida:

    * dedupe hit rate
    * nenhum side-effect duplicado (outbound)

### Critérios de aceite

* “at least once delivery” com “exactly once side-effects” (na prática: dedupe garante).

**Arquivos-alvo**

* `tests/chaos/*` (novo, raiz do repo)
* ou `packages/core-runtime/tests/chaos/*`

---

## EPIC F6.7 — Load testing (webhook + outbound)

**Objetivo:** validar capacidade e gargalos.

### F6.7.1 — Cenários

* WhatsApp inbound: 100 rps por 5 min
* Instagram inbound: 50 rps por 5 min
* Email inbound: 20 rps + bounces
* Outbound: 30 rps com retry em 10% requests

### F6.7.2 — Metas

* P95 webhook ≤ 200ms (sem sync pesado)
* sem memory leak
* sem aumento de 5xx

**Arquivos-alvo**

* `tests/load/*` (novo)
* scripts `pnpm load:*`

---

## EPIC F6.8 — Multi-instance simulation (dedupe distribuído + race conditions)

**Objetivo:** provar que 2+ instâncias não geram duplicação.

### F6.8.1 — Harness multi-process

**Entregas**

* subir 3 instâncias do mesmo app localmente
* balancear requests (round-robin)
* validar que dedupe Redis impede duplicação
* simular reorder (status chega antes da mensagem)

**Critérios de aceite**

* side-effects não duplicam (outbound)
* status reordenado não quebra consistência (eventual consistency)

**Arquivos-alvo**

* `tests/multi-instance/*` (novo)
* docker compose para redis + apps (se você já usa)

---

# Ordem de execução (Fase 6)

1. **F6.1 logs padronizados + correlação** (sem isso, todo o resto é cegueira)
2. **F6.1 métricas mínimas + dashboards base**
3. **F6.4 rate limits + quotas + circuit breaker** (protege custo e reputação)
4. **F6.3 secrets rotation** (suporte a dual-secret + runbook)
5. **F6.5 auditoria** (append-only + retenção)
6. **F6.6 chaos** (prova resiliência real)
7. **F6.7 load** (garante capacidade)
8. **F6.8 multi-instance** (prova consistência distribuída)

---

# Arquivos-alvo (resumo)

### Novo

* `packages/core-metrics/*` (se não existir)
* `packages/core-audit/*` (se não existir)
* `docs/runbooks/*`
* `docs/security/*`
* `tests/chaos/*`
* `tests/load/*`
* `tests/multi-instance/*`

### Alterar

* `packages/core-runtime/src/index.ts` (instrumentação por item/batch)
* `packages/core-webhooks/src/*` (validação signature + dual-secret)
* `packages/core-rate-limit/src/*` (quotas/circuit breaker)
* apps: WhatsApp/Instagram/Calendar/Email/Messenger para expor `/metrics` e padronizar logs

---

# Critérios finais de conclusão (gates de produção)

Um conector pode ser marcado como “prod-ready” quando:

* Passa testes unit + integration + chaos básico
* Tem dashboards e alertas mínimos
* Suporta rotação de secrets sem downtime
* Tem rate limit e quotas por tenant
* Emite audit records para ações sensíveis
* Tem runbook publicado

---

Vamos fechar com a **Fase 7** no mesmo nível de rigor das anteriores. Aqui é onde muitos projetos quebram: acham que “escala” é infra, quando na prática é **governança de código, contratos públicos, DX e controle de blast radius**. Se você errar aqui, qualquer parceiro vira um vetor de instabilidade.

Abaixo está a **Fase 7 — Distribuição & Escala (versão rica)**, com decisões duras, issue tree, ordem, arquivos-alvo e critérios de aceite.

---

# Fase 7 — Distribuição & Escala - Detalhada

## Decisões estruturais (bloqueantes)

### D7.0 — Connectors vira **plataforma**, não só repositório

A partir desta fase:

* o monorepo deixa de ser apenas interno;
* **pacotes viram produtos**;
* breaking change passa a ser **incidente**, não detalhe técnico.

Isso exige:

* versionamento rigoroso,
* contratos públicos,
* governança de contribuição.

---

### D7.1 — Separar claramente: *Core público* × *Infra privada*

Nem tudo pode ser publicado.

**Publicável (registry privado):**

* `core-events`
* `core-runtime` (API estável)
* `core-messaging`
* `core-email`
* `core-calendar`
* `core-automation`
* helpers (`core-http`, `core-rate-limit`, etc.)

**Privado (não publicado):**

* adapters com segredos embutidos
* apps com lógica operacional
* qualquer coisa que revele topologia interna

Regra simples:

> se um pacote exige secrets para existir, **não é público**.

---

### D7.2 — SemVer estrito + changelog automático

* `MAJOR`: quebra de contrato (schemas, eventos, runtime API)
* `MINOR`: feature backward-compatible
* `PATCH`: bugfix/observabilidade

**Não negociável:**
qualquer MAJOR exige:

* migração documentada
* release note clara
* período de convivência quando possível

---

### D7.3 — Terceiros nunca codam “direto no core”

Extensão externa ocorre via:

* templates/boilerplate
* contratos estáveis
* plugins/conectores isolados

Nunca via PR direto em `core-*` sem revisão profunda.

---

# 7.1 Publicação de pacotes

## EPIC F7.1 — Registry privado + pipeline de release

**Objetivo:** publicar e versionar pacotes com segurança.

### F7.1.1 — Registry privado npm

**Entregas**

* escolher registry (GitHub Packages / npm Enterprise / Verdaccio)
* autenticação por token
* escopos:

  * `@pyloto/core-*`
  * `@pyloto/connectors-*`

**Critérios de aceite**

* CI consegue publicar
* consumidores conseguem instalar com token scoped
* revogação funciona

**Arquivos-alvo**

* `.npmrc`
* `docs/registry.md`

---

### F7.1.2 — Versionamento semântico automatizado

**Entregas**

* padrão de commits (ex.: Conventional Commits)
* ferramenta de release:

  * semantic-release / changesets
* regra:

  * PR define tipo de mudança
  * CI calcula versão

**Critérios de aceite**

* ninguém “chuta” versão
* histórico consistente

**Arquivos-alvo**

* `.releaserc`
* `changeset.config.js` (se usar changesets)

---

### F7.1.3 — Changelog automático

**Entregas**

* `CHANGELOG.md` por pacote
* agrupado por versão:

  * Added
  * Changed
  * Fixed
  * Breaking

**Critérios de aceite**

* qualquer consumidor entende impacto antes de atualizar

---

## EPIC F7.2 — Políticas de compatibilidade e depreciação

**Objetivo:** evitar upgrade traumático.

### F7.2.1 — Política de depreciação

**Entregas**

* regras documentadas:

  * feature marcada como deprecated em MINOR
  * removida apenas em MAJOR
* warnings em runtime/log quando algo deprecated é usado

**Critérios de aceite**

* consumidor tem tempo para reagir

**Arquivos-alvo**

* `docs/versioning.md`
* `docs/deprecation-policy.md`

---

# 7.2 Templates de Conectores

## EPIC F7.3 — Template oficial de conector

**Objetivo:** “Create connector in 5 minutes” real, não marketing.

### F7.3.1 — Boilerplate de conector

**Entregas**

* repositório/template:

  * `@pyloto/connector-template`
* inclui:

  * estrutura de pastas
  * manifest de capabilities
  * webhook handler com batch
  * dedupe store plugável
  * logging/metrics padrão
  * testes base
  * README orientado a produção

**Critérios de aceite**

* um dev novo cria conector funcional sem ler o core-runtime inteiro

**Arquivos-alvo**

* `templates/connector/*` ou repo separado

---

### F7.3.2 — CLI “create-connector”

**Entregas**

* comando:

  ```bash
  npx @pyloto/create-connector my-connector
  ```
* prompts:

  * nome
  * provider
  * inbound/outbound
  * auth type
* gera:

  * pacote pronto
  * testes
  * scripts

**Critérios de aceite**

* tempo real < 5 minutos até `pnpm dev` rodando

**Arquivos-alvo**

* `packages/create-connector-cli/*`

---

### F7.3.3 — Conformance tests

**Objetivo:** impedir conectores malformados.

**Entregas**

* suíte de testes reutilizável:

  * valida manifest
  * valida dedupe
  * valida logs obrigatórios
  * valida batch safety
* conectores externos precisam passar nesses testes

**Critérios de aceite**

* nenhum conector “fora do padrão” entra no ecossistema

**Arquivos-alvo**

* `packages/connector-conformance-tests/*`

---

# 7.3 Consumo externo

## EPIC F7.4 — Consumo interno (outros projetos Pyloto)

**Objetivo:** dogfooding controlado.

### F7.4.1 — Contratos de uso interno

**Entregas**

* guidelines:

  * quais pacotes usar
  * como versionar dependência
  * quando atualizar
* ambientes:

  * dev / staging / prod com versões travadas

**Critérios de aceite**

* um projeto interno não quebra outro ao atualizar pacote

**Arquivos-alvo**

* `docs/internal-consumption.md`

---

## EPIC F7.5 — Consumo por terceiros (parceiros)

**Objetivo:** abrir sem perder controle.

### F7.5.1 — Níveis de parceria

**Entregas**

* tiers:

  * Internal
  * Partner
  * Certified Partner
* cada tier define:

  * acesso a pacotes
  * acesso a templates
  * SLA de suporte

**Critérios de aceite**

* blast radius controlado

---

### F7.5.2 — Documentação pública (DX)

**Entregas**

* portal docs (ou markdown versionado):

  * conceitos
  * lifecycle de evento
  * exemplos reais
  * anti-patterns
* exemplos de conectores reais:

  * Meta
  * Calendar
  * Email

**Critérios de aceite**

* terceiro integra sem suporte direto

**Arquivos-alvo**

* `docs/public/*`
* `docs/examples/*`

---

### F7.5.3 — Sandbox + limites

**Objetivo:** testar sem risco.

**Entregas**

* modo sandbox:

  * sem outbound real
  * payloads mockados
* rate limits agressivos
* watermark nos eventos

**Critérios de aceite**

* parceiro não testa em produção “sem querer”

---

# Ordem de execução recomendada (Fase 7)

1. **F7.1 registry + release pipeline**
2. **F7.2 versionamento + depreciação**
3. **F7.3 template + CLI**
4. **F7.3.3 conformance tests**
5. **F7.4 consumo interno**
6. **F7.5 consumo externo + docs públicas**
7. **Sandbox**

---

# Arquivos-alvo (resumo)

### Novos packages

* `packages/create-connector-cli/*`
* `packages/connector-conformance-tests/*`

### Templates

* `templates/connector/*`

### Docs

* `docs/registry.md`
* `docs/versioning.md`
* `docs/deprecation-policy.md`
* `docs/internal-consumption.md`
* `docs/public/*`

---

# Critérios finais de “escala de verdade”

Você pode dizer que a **Fase 7 está concluída** quando:

* Pacotes são publicados automaticamente com SemVer correto
* Breaking change nunca entra sem aviso e migração
* Criar um conector novo leva minutos, não dias
* Terceiros conseguem integrar sem tocar no core
* Um erro de parceiro **não** derruba produção
* O ecossistema cresce sem você virar gargalo

---

# Estado Final Esperado — Detalhado (Contrato de Resultado)

Ao final da execução completa das **Fases 1–7**, o projeto **Connectors** deixa de ser um repositório técnico e passa a ser uma **plataforma de integração madura, auditável e escalável**, com os seguintes atributos **verificáveis**:

---

## 1. Runtime Único, Maduro e Testado (Plataforma de Execução)

### Estado esperado

* Existe **um único runtime canônico**, responsável por:

  * ingestão de webhooks (batch-safe)
  * dedupe distribuído
  * rate limit por tenant
  * roteamento por capability
  * correlação end-to-end
* O runtime:

  * é **stateless**
  * suporta **N instâncias em paralelo**
  * não depende de ordem de chegada de eventos
  * garante *exactly-once side-effects* via dedupe

### Evidências objetivas

* Testes de:

  * batch delivery
  * multi-instance simulation
  * chaos (retry storm, reorder, timeout)
* Métricas:

  * dedupe hit rate observável
  * latência P95 dentro de SLO definido
* Runbook descrevendo:

  * falhas comuns
  * mitigação
  * rollback

**Resultado:**
O runtime é **infra-grade**, não “app-grade”.

---

## 2. Conectores em Produção Real (Mensageria, Calendário, Automação)

### Estado esperado

Os seguintes conectores estão **operacionais em produção**, com tráfego real, observabilidade e governança:

### Mensageria

* WhatsApp (Meta)
* Instagram DM
* Facebook Messenger
* Email (SES default + SendGrid/Mailgun opcionais)

### Calendário

* Google Calendar (OAuth + watch + sync consistente)
* (Opcional) CalDAV / Apple Calendar

### Automação / iPaaS

* Zapier
* Make (Integromat)

### Evidências objetivas

* Cada conector:

  * possui **manifest de capabilities**
  * tem **SLO definido**
  * emite métricas padronizadas
  * possui runbook próprio
* Nenhum conector:

  * executa lógica de domínio duplicada
  * depende de payload provider específico fora do adapter

**Resultado:**
Conectores são **plugáveis, isolados e previsíveis**, não “features acopladas”.

---

## 3. Domínios Canônicos Bem Definidos (Sem Ambiguidade)

### Estado esperado

Os principais domínios existem como **pacotes centrais, versionados e testados**, com contratos explícitos:

* `core-messaging`

  * DirectMessage
  * ReadReceipt
  * TypingIndicator
* `core-reactions`

  * Reaction
  * ReactionRemoved
* `core-email`

  * EmailSent / Received / Delivered / Bounced
* `core-calendar`

  * CalendarEventCreated / Updated / Deleted
* `core-automation`

  * Triggers
  * Actions
  * ExecutionResult
* `core-sync`

  * initial / incremental / reconcile

### Regras garantidas

* Nenhum app:

  * define schema próprio
  * duplica lógica de parsing
* Todo adapter:

  * converte provider → domínio canônico
  * usa helpers oficiais (dedupe, normalize, ids)

### Evidências objetivas

* Fixtures canônicas versionadas
* Testes de contrato que quebram CI em breaking change
* Changelogs claros por pacote

**Resultado:**
O sistema é **orientado a domínio**, não a providers.

---

## 4. Escala Horizontal Real (Não Teórica)

### Estado esperado

O sistema suporta crescimento **em tráfego, conectores e times**, sem refatorações estruturais.

### Garantias técnicas

* Stateless apps
* Dedupe distribuído (Redis ou equivalente)
* Rate limit e quotas por tenant
* Backpressure e circuit breakers
* Retry controlado (sem storms)

### Evidências objetivas

* Load tests documentados
* Multi-instance simulation aprovada
* Incidentes recuperáveis sem perda de consistência

**Resultado:**
Escalar significa **replicar**, não “reescrever”.

---

## 5. Segurança, Governança e Auditoria de Produção

### Estado esperado

A plataforma atende padrões reais de segurança operacional.

### Garantias

* Secrets:

  * inventariados
  * rotacionáveis sem downtime
* Auditoria:

  * append-only
  * tenant-scoped
  * retenção definida
* Eventos sensíveis auditados:

  * outbound
  * automações
  * rotação de secrets
  * integrações externas

### Evidências objetivas

* Logs estruturados sem PII
* Audit trail reconstruível por correlationId
* Runbooks de incidentes de segurança

**Resultado:**
O sistema é **defensável** em auditoria, não apenas funcional.

---

## 6. Plataforma Pronta para Distribuição e Reuso

### Estado esperado

O projeto **não depende do autor original** para crescer.

### Capacidades

* Pacotes publicados em registry privado
* Versionamento semântico rigoroso
* Changelog automático
* Política clara de depreciação

### DX (Developer Experience)

* CLI oficial:

  * `create-connector`
* Template de conector:

  * pronto para produção
  * com testes e observabilidade
* Conformance tests:

  * impedem conectores fora do padrão

### Evidências objetivas

* Um terceiro cria um conector funcional em minutos
* Um parceiro integra sem acesso ao core
* Um erro externo não derruba produção

**Resultado:**
O Connectors vira **plataforma extensível**, não código proprietário frágil.

---

## 7. Produto Reutilizável (Interno ou Comercial)

### Estado esperado

O Connectors pode ser:

* usado por múltiplos produtos Pyloto
* oferecido a parceiros estratégicos
* evoluído como produto comercial (se desejado)

### Características de produto

* Contratos estáveis
* Isolamento por tenant
* Custos previsíveis
* Governança clara
* Documentação pública suficiente

### Evidências objetivas

* Dogfooding interno bem-sucedido
* Integrações externas sem suporte manual
* Roadmap evolutivo baseado em domínio, não em exceções

**Resultado:**
O projeto deixa de ser “infra interna” e passa a ser **ativo estratégico**.

---

## Definição Final de Sucesso

O roadmap está **realmente concluído** quando:

* Nenhuma fase depende de “conhecimento tribal”
* Nenhum conector exige tratamento especial
* Nenhum domínio é ambíguo
* Nenhum crescimento exige reescrever o core
* O sistema sobrevive à ausência do autor original

Se qualquer um desses pontos falhar, o projeto **ainda não terminou**, apenas funciona.
