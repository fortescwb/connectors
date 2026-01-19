# TODO List - Connectors Monorepo

---

## 🚨 SPRINT-0: BLOQUEADORES CRÍTICOS

> **⚠️ ATENÇÃO:** As tarefas abaixo DEVEM ser concluídas ANTES de avançar com qualquer item dos documentos `Roadmap_CONNECTORS.md` ou `Roadmap_CONNECTORS_companion.md`.
>
> Estas tarefas visam zerar dívidas técnicas, garantir coerência entre código e documentação, e corrigir problemas de segurança/idempotência identificados na análise do Codex.

---

### 🔴 S0.1 — Consistência de Versionamento (Semver)

**Problema:** CHANGELOG.md declara release `0.3.0` mas a maioria dos packages permanece em `0.1.0`. Isso viola semver e causa confusão sobre o estado real do projeto.

**Tarefas:**
- [ ] **S0.1.1** Definir estratégia de versionamento:
  - Opção A: Versão única do monorepo (todos packages seguem versão raiz)
  - Opção B: Versões independentes por package (requer release tracking individual)
  - **Decisão recomendada:** Opção A para simplificar, usando `package.json` raiz como fonte de verdade
- [ ] **S0.1.2** Atualizar `package.json` de TODOS os packages para versão `0.3.0`:
  - `packages/core-runtime` (atualmente 0.2.0)
  - `packages/core-meta-instagram` (atualmente 0.1.0)
  - `packages/core-meta-whatsapp` (verificar)
  - `packages/core-*` (todos os demais)
  - `apps/whatsapp`, `apps/instagram`, `apps/calendar`, `apps/automation`
- [ ] **S0.1.3** Adicionar script `scripts/bump-version.sh` para atualizar versões atomicamente
- [ ] **S0.1.4** Documentar política de versionamento em `docs/VERSIONING.md`

**Arquivos afetados:**
- `package.json` (raiz e todos workspaces)
- `CHANGELOG.md`
- Criar `docs/VERSIONING.md`

---

### 🔴 S0.2 — Segurança de Dedupe em Outbound (replyClient)

**Problema Crítico:** `sendCommentReplyBatch()` em `core-meta-instagram/src/replyClient.ts` instancia `new InMemoryDedupeStore()` POR CHAMADA (linha ~115), efetivamente desabilitando deduplicação entre chamadas. Isso pode causar replies duplicados em produção.

**Tarefas:**
- [ ] **S0.2.1** Remover instanciação default de `InMemoryDedupeStore` dentro da função
- [ ] **S0.2.2** Tornar `dedupeStore` parâmetro OBRIGATÓRIO em `SendCommentReplyBatchOptions`
- [ ] **S0.2.3** Atualizar assinatura da função:
  ```typescript
  export interface SendCommentReplyBatchOptions {
    accessToken: string;
    dedupeStore: DedupeStore; // REQUIRED, não mais optional
    // ... resto
  }
  ```
- [ ] **S0.2.4** Adicionar erro explícito se `dedupeStore` não for fornecido:
  ```typescript
  if (!options.dedupeStore) {
    throw new Error('dedupeStore is required for safe outbound operations');
  }
  ```
- [ ] **S0.2.5** Atualizar testes para sempre passar `dedupeStore` explicitamente
- [ ] **S0.2.6** Documentar em README que caller DEVE gerenciar lifecycle do DedupeStore

**Arquivos afetados:**
- `packages/core-meta-instagram/src/replyClient.ts`
- `packages/core-meta-instagram/tests/replyClient.test.ts`
- `packages/core-meta-instagram/README.md`

---

### 🔴 S0.3 — Estabilidade de DedupeKey (idempotencyKey obrigatório)

**Problema:** `buildDedupeKey()` em `replyClient.ts` faz fallback para hash de conteúdo quando `idempotencyKey` está ausente. Em `index.ts`, `buildCommentReplyDedupeKey` usa timestamp quando `idempotencyKey` está ausente, gerando keys instáveis entre retries.

**Tarefas:**
- [ ] **S0.3.1** Tornar `idempotencyKey` campo OBRIGATÓRIO em `CommentReplyCommand`:
  ```typescript
  // Em core-comments
  export const CommentReplyCommandSchema = z.object({
    // ...
    idempotencyKey: z.string().min(1), // Era optional, agora required
  });
  ```
- [ ] **S0.3.2** Remover lógica de fallback em `buildDedupeKey()`:
  ```typescript
  function buildDedupeKey(command: CommentReplyCommand): string {
    // Sem fallback - idempotencyKey é garantido pelo schema
    return buildCommentReplyDedupeKey(
      command.platform, 
      command.externalCommentId, 
      command.idempotencyKey
    );
  }
  ```
- [ ] **S0.3.3** Atualizar `buildCommentReplyDedupeKey` em `core-comments` para não aceitar undefined
- [ ] **S0.3.4** Atualizar todos os testes que criam `CommentReplyCommand` sem `idempotencyKey`
- [ ] **S0.3.5** Adicionar documentação explicando que caller deve gerar UUID/ULID para `idempotencyKey`

**Arquivos afetados:**
- `packages/core-comments/src/index.ts` (ou schemas.ts)
- `packages/core-meta-instagram/src/replyClient.ts`
- `packages/core-meta-instagram/src/index.ts`
- `packages/core-meta-instagram/tests/*.test.ts`
- `packages/core-comments/README.md`

---

### 🟡 S0.4 — Lint Warnings Cleanup

**Problema:** Build passa com warnings que indicam código morto ou type-safety reduzida.

**Tarefas:**
- [ ] **S0.4.1** Remover imports não utilizados em `core-runtime/src/index.ts`:
  - `emitMetric` (linha ~20) — verificar se é re-exportado mas não usado internamente
  - `RuntimeMetric` type alias (linha ~360) — substituir por uso direto de `ObservabilityMetric`
- [ ] **S0.4.2** Limpar imports não utilizados em `packages/core-runtime/tests/*`
- [ ] **S0.4.3** Remover uso de `any` em `core-meta-instagram/tests/parser.test.ts` (linhas ~19-53):
  - Criar tipos apropriados para fixtures de teste
  - Usar `unknown` com type guards onde necessário
- [ ] **S0.4.4** Tipar corretamente handler em `apps/instagram/src/app.ts`:
  ```typescript
  // Antes (warning):
  ctx.logger.info('Received Instagram DM', {
    mid: (event as any).mid,
    sender: (event as any).senderId
  });
  
  // Depois (tipado):
  import type { InstagramMessageNormalized } from '@connectors/core-meta-instagram';
  
  inbound_messages: async (event: InstagramMessageNormalized, ctx) => {
    ctx.logger.info('Received Instagram DM', {
      mid: event.mid,
      sender: event.senderId
    });
  }
  ```
- [ ] **S0.4.5** Executar `pnpm lint` e garantir 0 warnings (não apenas 0 errors)
- [ ] **S0.4.6** Atualizar ESLint config para tratar warnings específicos como errors:
  ```javascript
  // eslint.config.js
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error', // era 'warn'
  }
  ```

**Arquivos afetados:**
- `packages/core-runtime/src/index.ts`
- `packages/core-runtime/tests/*.ts`
- `packages/core-meta-instagram/tests/parser.test.ts`
- `apps/instagram/src/app.ts`
- `eslint.config.js`

---

### 🟡 S0.5 — Auditoria de Capability Status

**Problema:** Manifests declaram capabilities como `active` que na verdade dependem de InMemoryDedupeStore (não production-ready) ou não estão wired no app.

**Rubric (Sprint-0, binário)**

| Status    | Requisitos mínimos                                                                                                  |
|-----------|----------------------------------------------------------------------------------------------------------------------|
| planned   | Intenção apenas; nenhuma entrega funcional, sem fixtures reais, sem handlers/clientes.                              |
| scaffold  | Código parcial (schemas/cliente/handler) mas faltam fixtures reais **ou** handlers não wired **ou** sem dedupe/logs.|
| active    | Parser ou client real com fixtures determinísticas; handler/client wired; testes cobrindo batch + dedupe estável; per-item logging (correlationId + dedupeKey); dedupeStore configurável (não hardcoded); sem SLO/runbook. |
| beta      | Todos os itens de `active` + observabilidade consolidada (métricas/traços), runbook mínimo; SLO/alertas ainda em construção. |
| prod      | Todos os itens de `beta` + SLO publicado, alertas/rotações de secrets e auditoria aplicadas.                        |

**Tarefas:**
- [ ] **S0.5.1** Aplicar rubric acima a todos os manifests/apps listados.
- [ ] **S0.5.2** Ajustar status/descrições em manifests para refletir evidência real; adicionar notas de limitação quando dependem de store in-memory ou client não wired.

**Arquivos afetados:**
- `packages/core-connectors/src/index.ts` (schema de capability)
- `apps/instagram/src/manifest.ts`
- `apps/whatsapp/src/app.ts`
- `README.md`
- `docs/architecture.md`

---

### 🟡 S0.6 — Coerência de Documentação

**Problema:** README.md, architecture.md e TODO_list.md fazem afirmações sobre features que não estão completamente implementadas ou têm ressalvas não documentadas.

**Tarefas:**
- [ ] **S0.6.1** Atualizar README.md seção "Apps":
  - Adicionar nota sobre requirements de produção (Redis, env vars)
  - Clarificar que scaffolds (calendar, automation) são apenas estrutura
- [ ] **S0.6.2** Atualizar docs/architecture.md:
  - Seção de dedupe: explicitar que `InMemoryDedupeStore` é single-instance only
  - Seção de outbound: documentar que `sendCommentReplyBatch` requer caller-managed DedupeStore
- [ ] **S0.6.3** Criar `docs/PRODUCTION_CHECKLIST.md`:
  ```markdown
  # Production Checklist
  
  ## Required for Production Deployment
  - [ ] Configure RedisDedupeStore (not InMemory)
  - [ ] Set WEBHOOK_SECRET environment variables
  - [ ] Configure rate limiting
  - [ ] Set up monitoring/alerting
  - [ ] Review PII logging guidelines
  ```
- [ ] **S0.6.4** Atualizar CHANGELOG.md 0.3.0 com notas de "Known Limitations":
  ```markdown
  ### Known Limitations
  - Instagram comment-reply client not yet wired in app
  - InMemoryDedupeStore used by default (not suitable for multi-instance)
  - Rate limiting uses NoopRateLimiter by default
  ```

**Arquivos afetados:**
- `README.md`
- `docs/architecture.md`
- `CHANGELOG.md`
- Criar `docs/PRODUCTION_CHECKLIST.md`

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
