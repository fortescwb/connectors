### TODO geral

1. **Limpar variáveis/imports não utilizados**

   * ✅ Removida constante `_defaultLogger` não utilizada em `buildWebhookHandlers`
   * ✅ Revisados testes — imports estão corretos

2. **Gerenciar backlog e tarefas**

   * ✅ `.local/` está no `.gitignore` e não entra no fluxo.
   * Para backlog formal rastreável, utilize GitHub Issues.

3. **Atualizar documentação**

   * ✅ README atualizado com estrutura atual e próximos passos
   * ✅ `docs/architecture.md` atualizado com domínios planejados e RedisDedupeStore
   * ✅ `core-runtime/README.md` reescrito para refletir `parseEvents`, `BatchSummary`, `BatchItemResult` e `fullyDeduped`

4. **Planejar novos domínios e pacotes**

   * ✅ `core-messaging` implementado parcialmente (tipos outbound: `OutboundMessageIntent`)
   * ✅ `core-reactions` documentado em `docs/architecture.md` (pacote não criado)
   * Próximo: implementar parsing de DMs inbound em `core-messaging` quando houver demanda real

5. **Implementar `DedupeStore` persistente**

   * ✅ `RedisDedupeStore` implementado em `core-runtime` com:
     - Interface `RedisClient` compatível com ioredis/node-redis
     - Fail modes: `open` (bloqueia em erro) e `closed` (permite em erro)
     - TTL configurável via parâmetro
     - Documentação no README do `core-runtime`

6. **Desenvolver conectores para calendários e automação**

   * ✅ Scaffolds criados em `apps/calendar` e `apps/automation`:
     - ConnectorManifest com capabilities planejadas
     - Health endpoint funcional
     - parseEvent stub com TODO explícito
     - Testes mínimos (health + webhook 400/503)
   * Próximo passo: implementar integração real com provedores (Google Calendar, Zapier, etc.)

7. **Publicação e uso de pacotes**

   * Se os pacotes `@connectors/core-*` serão consumidos por outros repositórios, definir um processo de publicação em registry privado (npm privado). Atualizar `package.json` com `publishConfig` apropriado e ajustar pipelines de CI/CD para gerar e publicar os artefatos.

8. **Checklist para novos conectores**

   * Manter um checklist de criação de novos conectores com as etapas básicas (manifest, auth, webhook signature, raw body, endpoints `/webhook` e `/health`, testes mínimos, documentação) alinhadas ao runtime unificado.
   * Usar o `core-runtime` para evitar duplicação de lógica em correlação, assinatura, dedupe e rate‑limit.

---

### 🚧 Backlog Técnico (G1/G2 Review)

#### Rate Limiting & Paralelismo

- [ ] **Paralelismo controlado para webhooks grandes**: Atualmente o runtime processa eventos em **série** (determinismo de logs). Para batches grandes (>100 eventos), considerar opção `parallelism: number` com `Promise.allSettled()` e ordem preservada via índice.
- [x] **Rate limiter por batch**: Chamado 1× por request com `cost = events.length`. Key usado: `tenant ?? manifest.id`.
- [ ] **Rate limiter por item (opcional)**: Se necessário granularidade por item, adicionar flag `rateLimitPerItem: boolean` no config.

#### Segurança de Logs (PII/Payload)

- [x] **Logs não expõem payloads brutos**: Runtime loga apenas metadados (`dedupeKey`, `capabilityId`, `outcome`, `latencyMs`, `errorCode`). Payloads ficam sob responsabilidade do handler.
- [x] **Guideline de logging para handlers**: Documentado em `core-runtime/README.md` que handlers NÃO devem logar `event.payload` diretamente.

#### Testes Cross-Instância (Dedupe)

- [x] **InMemoryDedupeStore testado**: Cobre cenário single-instance.
- [x] **RedisDedupeStore teste de integração**: Implementado com testcontainers - prova dedupe cross-instance, TTL expiry, e fail modes. Roda com Podman/Docker.

#### Versionamento & Commits

- [ ] **Semver rigoroso**: Qualquer mudança de contrato de resposta HTTP (campos, tipos) requer bump de major version.
- [ ] **Commits atômicos**: Um commit = um tema. Separar runtime/apps/docs em PRs distintos quando possível.
- [x] **CHANGELOG.md**: Criado arquivo de changelog para rastrear evolução do contrato.

---

### ✅ G1 (Batch-Safe Runtime) — Fechado

**Critérios atendidos:**
- [x] `parseEvents` com processamento item-by-item
- [x] Dedupe por item com `DedupeStore.checkAndMark()`
- [x] Logs por item: `correlationId`, `capabilityId`, `dedupeKey`, `outcome`, `latencyMs`
- [x] Assinatura validada 1× por batch (401 em falha)
- [x] Parse error → 400 (antes de processar itens)
- [x] Falhas parciais → 200 com `summary.failed > 0`
- [x] `fullyDeduped` como campo canônico (sem ambiguidade com `summary.deduped`)
- [x] Documentação de `core-runtime/README.md` atualizada

---

### ✅ G2 (WhatsApp Inbound Real) — Fechado

**Critérios atendidos:**
- [x] `core-meta-whatsapp` com Zod schemas para payloads Meta reais
- [x] Fixtures reais de webhook do WhatsApp Business API
- [x] Parser extrai `dedupeKey` de `wamid` (message ID)
- [x] Testes com fixtures reais passando
- [x] Integração com `apps/whatsapp` usando `parseEvents`

---

### ✅ F1.4 (Instagram DM Inbound Real) — Fechado

**Critérios atendidos:**
- [x] `core-meta-instagram` criado com Zod schemas para payloads Meta Instagram reais
- [x] Fixtures reais de webhook (text message, media message, batch)
- [x] `parseInstagramRuntimeRequest()` com processamento batch-safe
- [x] Parser extrai `dedupeKey` no formato `instagram:{recipientId}:msg:{mid}`
- [x] Testes de parser passando (single, media, batch, invalid)
- [x] Integração com `apps/instagram` — fake parsing removido
- [x] Capability `inbound_messages` promovida para `active`
- [x] Testes de integração com fixtures reais (17 testes passando)

---

### 🚧 F1.5 (Instagram Comment Reply) — Parcial

**Library code implementado:**
- [x] `sendCommentReplyBatch()` implementado em `core-meta-instagram`
- [x] Retry/backoff configurável (default 3 tentativas, 200ms base)
- [x] Dedupe check antes de HTTP call
- [x] Error classification: client_error, retry_exhausted, timeout, network_error
- [x] Integração com Facebook Graph API v19.0
- [x] Testes de reply client (success, dedupe, retry on 500, timeout handling)

**Pendente para promover a active:**
- [ ] Wiring no app Instagram (handler capability registrado)
- [ ] End-to-end integration test
- [ ] DedupeKey review: usar command ID estável, não apenas content hash
- [ ] Capability `comment_reply` mantida como `planned` até wiring completo
