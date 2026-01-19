# TODO List - Connectors Monorepo

---

## 🚨 SPRINT-0: BLOQUEADORES CRÍTICOS

> **⚠️ ATENÇÃO:** As tarefas abaixo DEVEM ser concluídas ANTES de avançar com qualquer item dos documentos `Roadmap_CONNECTORS.md` ou `Roadmap_CONNECTORS_companion.md`.
>
> Estas tarefas visam zerar dívidas técnicas, garantir coerência entre código e documentação, e corrigir problemas de segurança/idempotência identificados na análise do Codex.

---

### 🔴 S0.1 — Consistência de Versionamento (Semver) — ✅ Concluído (auditoria 2026-01-19)

Decisão fixa: estratégia B (versões independentes por package). Semver aplicado por pacote; CHANGELOG segmentado por package/data.
- [x] Estratégia B aplicada; releases registrados em `CHANGELOG.md` (2026-01-18/19) por package.
- [x] Versões alinhadas: core-runtime@0.2.0, core-comments@0.2.0, core-meta-instagram@0.2.0, core-meta-whatsapp@0.1.0, instagram-app@0.2.0; demais scaffolds permanecem 0.1.0.
- [x] Dependências internas normalizadas para `workspace:^` (apps/* e packages/*).
- [ ] Automação de bump/documentação dedicada (scripts/bump-version, docs/VERSIONING) — adiado para ciclo de release automation.

---

### 🔴 S0.2 — Segurança de Dedupe em Outbound (replyClient) — ✅ Concluído (auditoria 2026-01-19)

Estado resolvido:
- [x] `sendCommentReplyBatch` exige `dedupeStore` e valida antes de qualquer HTTP; nenhum `InMemoryDedupeStore` é instanciado internamente (packages/core-meta-instagram/src/replyClient.ts).
- [x] Dedupe ocorre antes do side-effect e mantém `fullyDeduped` correto no runtime.
- [x] Testes usam store compartilhado e cobrem ausência de dedupeStore (packages/core-meta-instagram/tests/replyClient.test.ts).
- [x] README do package orienta que o caller gerencia o lifecycle do store (packages/core-meta-instagram/README.md).

---

### 🔴 S0.3 — Estabilidade de DedupeKey (idempotencyKey obrigatório) — ✅ Concluído (auditoria 2026-01-19)

Estado resolvido:
- [x] `idempotencyKey` obrigatório em `CommentReplyCommand` (packages/core-comments/src/index.ts).
- [x] `buildCommentReplyDedupeKey` determinístico: platform + tenant + commentId + idempotencyKey; sem hash/timestamp.
- [x] `sendCommentReplyBatch` lança se idempotencyKey ausente; dedupeKey usa o schema canônico.
- [x] Testes cobrem missing idempotencyKey e cenários de dedupe/non-dedupe (packages/core-meta-instagram/tests/replyClient.test.ts).

---

### 🟡 S0.4 — Lint Warnings Cleanup — ✅ Concluído (auditoria 2026-01-19)

Estado resolvido:
- [x] Sem `any` residual em apps/instagram handler ou testes core-meta-instagram.
- [x] Imports não utilizados removidos de core-runtime; lint retorna 0 errors/0 warnings (`pnpm -w lint`).
- [x] Testes e build verdes (`pnpm -w test`, `pnpm -w build`).

---

### 🟡 S0.5 — Auditoria de Capability Status — ✅ Concluído (auditoria 2026-01-19)

Rubric canônico (binário) mantido neste arquivo; companion alinhado.
- [x] Rubric planned/scaffold/active/beta/prod definido abaixo e usado como gate.
- [x] Manifests auditados:
  - Instagram: inbound_messages active; webhook_verification active; comment_reply planned (library only, not wired); demais planned.
  - WhatsApp: inbound_messages active; message_status_updates active; outbound_messages planned; webhook_verification active.
  - Calendar/Automation: todos planned.
- [x] Notas de produção incluídas onde dependem de dedupe store compartilhado.

| Status    | Requisitos mínimos                                                                                                  |
|-----------|----------------------------------------------------------------------------------------------------------------------|
| planned   | Intenção apenas; nenhuma entrega funcional, sem fixtures reais, sem handlers/clientes.                              |
| scaffold  | Código parcial (schemas/cliente/handler) mas faltam fixtures reais **ou** handlers não wired **ou** sem dedupe/logs.|
| active    | Parser ou client real com fixtures determinísticas; handler/client wired; testes cobrindo batch + dedupe estável; per-item logging (correlationId + dedupeKey); dedupeStore configurável; sem SLO/runbook. |
| beta      | Tudo de `active` + observabilidade consolidada (métricas/traços), runbook mínimo; SLO/alertas em construção. |
| prod      | Tudo de `beta` + SLO publicado, alertas/rotações de secrets e auditoria aplicadas.                        |

---

### 🟡 S0.6 — Coerência de Documentação — ✅ Concluído (auditoria 2026-01-19)

Estado resolvido:
- [x] README raiz, docs/architecture.md e CHANGELOG.md alinhados aos manifests (comment_reply permanece planned/library-only; sem promessas de exactly-once end-to-end).
- [x] Packages README atualizados conforme necessário (core-meta-instagram dedupe/idempotency guidance).
- [x] Capabilities listadas com status reais e notas de produção (dedupe store compartilhado para ambientes distribuídos).

---

### 🟢 S0.7 — Remoção de Código Legacy

**Problema:** Packages `adapter-express` e `core-webhooks` estão marcados como deprecated mas ainda presentes e podem causar confusão.

**Tarefas:**
- [ ] **S0.7.1** Verificar se algum código ainda importa de `adapter-express`:
  - `apps/whatsapp` usa `rawBodyMiddleware` — manter se necessário
  - Se usado apenas para rawBody, considerar inline ou mover para `core-runtime`
- [ ] **S0.7.2** Verificar se algum código ainda importa de `core-webhooks`:
  - Se não, mover para `_deprecated/` ou remover
- [ ] **S0.7.3** Se mantidos, adicionar `@deprecated` JSDoc em todos exports:
  ```typescript
  /**
   * @deprecated Use core-runtime instead. Will be removed in v1.0.0
   */
  export function oldFunction() { ... }
  ```
- [ ] **S0.7.4** Atualizar `pnpm-workspace.yaml` se packages forem removidos

**Arquivos afetados:**
- `packages/adapter-express/*`
- `packages/core-webhooks/*`
- `pnpm-workspace.yaml`

---

### 🟢 S0.8 — Normalização de devDependencies

**Problema:** `package.json` raiz define versões e depois sobrescreve via `pnpm.overrides`, causando confusão.

**Tarefas:**
- [ ] **S0.8.1** Remover `pnpm.overrides` e atualizar versões diretas:
  ```json
  {
    "devDependencies": {
      "prettier": "3.8.0",
      "typescript": "5.9.3",
      "vitest": "1.6.1"
    }
  }
  ```
- [ ] **S0.8.2** Verificar se overrides eram necessários por conflito de versões
- [ ] **S0.8.3** Executar `pnpm install` e validar que tudo funciona
- [ ] **S0.8.4** Documentar em comentário se overrides forem mantidos por razão específica

**Arquivos afetados:**
- `package.json` (raiz)

---

## ✅ CRITÉRIOS DE CONCLUSÃO DO SPRINT-0

Antes de prosseguir com Roadmap_CONNECTORS.md:

1. **Lint:** `pnpm lint` retorna 0 errors E 0 warnings
2. **Testes:** `pnpm test` passa 100%
3. **Build:** `pnpm build` sem errors
4. **Versões:** Todos packages em versão consistente com CHANGELOG
5. **Dedupe:** Nenhum código instancia DedupeStore internamente para outbound
6. **Docs:** README e architecture.md refletem estado real do código
7. **Capabilities:** Status de manifests refletem implementação real

---

## 📋 Prioridade de Execução

| Ordem | Task   | Criticidade | Esforço  | Motivo                                      |
|-------|--------|-------------|----------|---------------------------------------------|
| 1     | S0.2   | 🔴 Alta     | Médio    | Bug de segurança — replies duplicados       |
| 2     | S0.3   | 🔴 Alta     | Médio    | Idempotência quebrada                       |
| 3     | S0.4   | 🟡 Média    | Baixo    | Type safety e código limpo                  |
| 4     | S0.1   | 🟡 Média    | Baixo    | Confusão de versões                         |
| 5     | S0.5   | 🟡 Média    | Médio    | Expectativas incorretas de ops              |
| 6     | S0.6   | 🟡 Média    | Médio    | Documentação enganosa                       |
| 7     | S0.7   | 🟢 Baixa    | Baixo    | Limpeza de tech debt                        |
| 8     | S0.8   | 🟢 Baixa    | Baixo    | Confusão de config                          |

---

---

## 📝 TODO Geral (Pós Sprint-0)

> As tarefas abaixo são válidas mas NÃO devem ser iniciadas até conclusão do Sprint-0.

### 1. Limpar variáveis/imports não utilizados

* ✅ Removida constante `_defaultLogger` não utilizada em `buildWebhookHandlers`
* ✅ Revisados testes — imports estão corretos
* ⏳ Pendente S0.4 para cleanup completo

### 2. Gerenciar backlog e tarefas

* ✅ `.local/` está no `.gitignore` e não entra no fluxo.
* Para backlog formal rastreável, utilize GitHub Issues.

### 3. Atualizar documentação

* ✅ README atualizado com estrutura atual e próximos passos
* ✅ `docs/architecture.md` atualizado com domínios planejados e RedisDedupeStore
* ✅ `core-runtime/README.md` reescrito para refletir `parseEvents`, `BatchSummary`, `BatchItemResult` e `fullyDeduped`
* ⏳ Pendente S0.6 para coerência completa

### 4. Planejar novos domínios e pacotes

* ✅ `core-messaging` implementado parcialmente (tipos outbound: `OutboundMessageIntent`)
* ✅ `core-reactions` documentado em `docs/architecture.md` (pacote não criado)
* Próximo: implementar parsing de DMs inbound em `core-messaging` quando houver demanda real

### 5. Implementar `DedupeStore` persistente

* ✅ `RedisDedupeStore` implementado em `core-runtime` com:
  - Interface `RedisClient` compatível com ioredis/node-redis
  - Fail modes: `open` (bloqueia em erro) e `closed` (permite em erro)
  - TTL configurável via parâmetro
  - Documentação no README do `core-runtime`

### 6. Desenvolver conectores para calendários e automação

* ✅ Scaffolds criados em `apps/calendar` e `apps/automation`:
  - ConnectorManifest com capabilities planejadas
  - Health endpoint funcional
  - parseEvent stub com TODO explícito
  - Testes mínimos (health + webhook 400/503)
* Próximo passo: implementar integração real com provedores (Google Calendar, Zapier, etc.)

### 7. Publicação e uso de pacotes

* Se os pacotes `@connectors/core-*` serão consumidos por outros repositórios, definir um processo de publicação em registry privado (npm privado). Atualizar `package.json` com `publishConfig` apropriado e ajustar pipelines de CI/CD para gerar e publicar os artefatos.

### 8. Checklist para novos conectores

* Manter um checklist de criação de novos conectores com as etapas básicas (manifest, auth, webhook signature, raw body, endpoints `/webhook` e `/health`, testes mínimos, documentação) alinhadas ao runtime unificado.
* Usar o `core-runtime` para evitar duplicação de lógica em correlação, assinatura, dedupe e rate‑limit.

---

## 🚧 Backlog Técnico (G1/G2 Review)

### Rate Limiting &amp; Paralelismo

- [ ] **Paralelismo controlado para webhooks grandes**: Atualmente o runtime processa eventos em **série** (determinismo de logs). Para batches grandes (>100 eventos), considerar opção `parallelism: number` com `Promise.allSettled()` e ordem preservada via índice.
- [x] **Rate limiter por batch**: Chamado 1× por request com `cost = events.length`. Key usado: `tenant ?? manifest.id`.
- [ ] **Rate limiter por item (opcional)**: Se necessário granularidade por item, adicionar flag `rateLimitPerItem: boolean` no config.

### Segurança de Logs (PII/Payload)

- [x] **Logs não expõem payloads brutos**: Runtime loga apenas metadados (`dedupeKey`, `capabilityId`, `outcome`, `latencyMs`, `errorCode`). Payloads ficam sob responsabilidade do handler.
- [x] **Guideline de logging para handlers**: Documentado em `core-runtime/README.md` que handlers NÃO devem logar `event.payload` diretamente.

### Testes Cross-Instância (Dedupe)

- [x] **InMemoryDedupeStore testado**: Cobre cenário single-instance.
- [x] **RedisDedupeStore teste de integração**: Implementado com testcontainers - prova dedupe cross-instance, TTL expiry, e fail modes. Roda com Podman/Docker.

### Versionamento &amp; Commits

- [ ] **Semver rigoroso**: Qualquer mudança de contrato de resposta HTTP (campos, tipos) requer bump de major version.
- [ ] **Commits atômicos**: Um commit = um tema. Separar runtime/apps/docs em PRs distintos quando possível.
- [x] **CHANGELOG.md**: Criado arquivo de changelog para rastrear evolução do contrato.

---

## ✅ Gates Fechados

### G1 (Batch-Safe Runtime) — Fechado

**Critérios atendidos:**
- [x] `parseEvents` com processamento item-by-item
- [x] Dedupe por item com `DedupeStore.checkAndMark()`
- [x] Logs por item: `correlationId`, `capabilityId`, `dedupeKey`, `outcome`, `latencyMs`
- [x] Assinatura validada 1× por batch (401 em falha)
- [x] Parse error → 400 (antes de processar itens)
- [x] Falhas parciais → 200 com `summary.failed > 0`
- [x] `fullyDeduped` como campo canônico (sem ambiguidade com `summary.deduped`)
- [x] Documentação de `core-runtime/README.md` atualizada

### G2 (WhatsApp Inbound Real) — Fechado

**Critérios atendidos:**
- [x] `core-meta-whatsapp` com Zod schemas para payloads Meta reais
- [x] Fixtures reais de webhook do WhatsApp Business API
- [x] Parser extrai `dedupeKey` de `wamid` (message ID)
- [x] Testes com fixtures reais passando
- [x] Integração com `apps/whatsapp` usando `parseEvents`

### F1.4 (Instagram DM Inbound Real) — Fechado*

**Critérios atendidos:**
- [x] `core-meta-instagram` criado com Zod schemas para payloads Meta Instagram reais
- [x] Fixtures reais de webhook (text message, media message, batch)
- [x] `parseInstagramRuntimeRequest()` com processamento batch-safe
- [x] Parser extrai `dedupeKey` no formato `instagram:{recipientId}:msg:{mid}`
- [x] Testes de parser passando (single, media, batch, invalid)
- [x] Integração com `apps/instagram` — fake parsing removido
- [x] Capability `inbound_messages` promovida para `active`
- [x] Testes de integração com fixtures reais (17 testes passando)

**⚠️ Ressalvas (a resolver em S0.5):**
- Usa `InMemoryDedupeStore` por default — não production-ready
- Handler usa `any` cast — type safety reduzida

---

## 🚧 F1.5 (Instagram Comment Reply) — Parcial

**Library code implementado:**
- [x] `sendCommentReplyBatch()` implementado em `core-meta-instagram`
- [x] Retry/backoff configurável (default 3 tentativas, 200ms base)
- [x] Dedupe check antes de HTTP call
- [x] Error classification: client_error, retry_exhausted, timeout, network_error
- [x] Integração com Facebook Graph API v19.0
- [x] Testes de reply client (success, dedupe, retry on 500, timeout handling)

**Bloqueado por Sprint-0:**
- [ ] S0.2 — DedupeStore obrigatório (não instanciar internamente)
- [ ] S0.3 — idempotencyKey obrigatório (não usar fallback)

**Pendente para promover a active (pós S0):**
- [ ] Wiring no app Instagram (handler capability registrado)
- [ ] End-to-end integration test
- [ ] Capability `comment_reply` mantida como `planned` até wiring completo
