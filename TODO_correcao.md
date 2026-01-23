# TODO_correcao.md — Plano de Correção e Limpeza (apps/instagram + apps/whatsapp)

Contexto: este TODO consolida ações para deixar o repositório **mais limpo, organizado, coerente e seguro**, sem quebrar o que já está validado em Staging no **WhatsApp** (texto, áudio, documento, vídeo, figurinha, reação, template, contato e localização).  
Baseado nas convenções do monorepo (`apps/*` como edge; `packages/*` como domínio/adapters/runtime), no uso do runtime batch-safe (`parseEvents`, `RedisDedupeStore`, logs sem PII) e na política de capabilities/gates descrita no roadmap/companion. fileciteturn0file5 fileciteturn0file6 fileciteturn0file8

---

## 0) Regras inegociáveis (gates antes de qualquer refactor)

### 0.1 Não quebrar WhatsApp Staging (regressão obrigatória)
- [ ] **T0.1 — Congelar “suite de regressão” para os tipos WhatsApp já aprovados**
  - **Objetivo:** qualquer refactor só entra se **provar** que os 9 tipos continuam funcionando.
  - **Entregas:**
    - Fixtures reais/sanitizadas (1 por tipo) + 1 fixture “batch misto”.
    - Testes de integração no `apps/whatsapp` exercitando `parseEvents` + runtime + handlers.
    - Assert de: `summary.total/processed/failed`, `results[].deduped`, e logs por item (sem payload).
  - **Arquivos-alvo (exemplos):**
    - `apps/whatsapp/tests/fixtures/*`
    - `apps/whatsapp/tests/webhook.*.test.*`
    - `packages/core-runtime/tests/*` (se necessário ampliar)
  - **Critérios de aceite:**
    - CI local: `pnpm --filter apps/whatsapp test` passando.
    - Rodar em Staging com payload real: nenhum tipo regressa.
  - **Prioridade:** P0

### 0.2 “Active” só com lastro (payload real + fixtures reais + testes)
- [ ] **T0.2 — Auditar manifests e rebaixar capabilities sem lastro para `scaffold/planned`**
  - **Objetivo:** evitar “capability marketing”, mantendo o repo coerente com a política de promoção para `active`. fileciteturn0file8
  - **Entregas:**
    - Ajustar manifests no `apps/instagram` para refletir que DM/tipos ainda não foram validados em Staging.
    - Garantir que WhatsApp mantenha `active` apenas para o que está comprovado por fixtures e testes.
  - **Critérios de aceite:**
    - Nenhuma capability marcada `active` sem fixtures reais + testes reais.
  - **Prioridade:** P0

---

## 1) Higiene estrutural (repo limpo e sem redundâncias)

### 1.1 Consolidar responsabilidades (apps ≠ provider parsing ≠ domínio)
- [ ] **T1.1 — Garantir que `apps/*` não contenha parsing/provider logic duplicado**
  - **Objetivo:** apps devem ser “edge”: endpoints, validação de assinatura, wiring do runtime; parsing deve estar em `packages/core-<provider>/*`. fileciteturn0file8
  - **Ações:**
    - Mapear pontos no `apps/instagram` e `apps/whatsapp` onde exista:
      - validação Zod do payload provider dentro do app;
      - montagem de dedupeKey dentro do app;
      - normalização de payload Meta dentro do app.
    - Extrair para `packages/core-meta-instagram` e `packages/core-meta-whatsapp` (WhatsApp já existe como package; Instagram deve ficar simétrico).
  - **Critérios de aceite:**
    - `apps/*` importa apenas `packages/*` e não “re-inventa” schema/dedupeKey.
  - **Prioridade:** P0/P1

### 1.2 Remover redundâncias e “legado em depreciação”
- [ ] **T1.2 — Remover/encapsular uso remanescente de `core-webhooks`/`adapter-express` se ainda existir**
  - **Objetivo:** reduzir caminhos paralelos para webhooks e evitar drift (um conector usando runtime novo e outro usando stack antiga). fileciteturn0file6
  - **Entregas:**
    - Identificar importações/uso ainda ativos.
    - Migrar para `core-runtime` (buildWebhookHandlers/parseEvents) e remover rotas/handlers duplicados.
  - **Critérios de aceite:**
    - Apenas um “golden path” de webhook por app.
  - **Prioridade:** P1

### 1.3 Normalizar convenções de arquivos e exports
- [x] **T1.3 — Padronizar `index.ts` como barrel export e separar `types.ts` / `schemas.ts`**
  - **Objetivo:** reduzir import cycles e facilitar auditoria.
  - **Entregas:**
    - `packages/core-meta-*/src/{schemas.ts,types.ts,parseWebhook.ts,map*.ts,index.ts}`
    - Exports explícitos; nenhum export implícito “grande”.
  - **Critérios de aceite:**
    - Tree-shaking e imports mais previsíveis; lint sem warnings.
  - **Prioridade:** P2

---

## 2) WhatsApp (manter funcionando e melhorar segurança/clareza)

> Garantia: qualquer mudança aqui deve passar por **T0.1**.

### 2.1 DedupeKey e correlação: padronizar e blindar
- [ ] **T2.1 — Verificar consistência do dedupeKey por tipo de mensagem**
  - **Objetivo:** assegurar que todos os tipos (texto/áudio/doc/vídeo/figurinha/reação/template/contato/localização) derivam dedupeKey de identificador estável do provider e não de campos variáveis.
  - **Entregas:**
    - Teste unitário no `core-meta-whatsapp` por tipo garantindo:
      - dedupeKey presente
      - formato consistente
      - não inclui PII (telefone/nome) em claro
  - **Critérios de aceite:**
    - `dedupeKey` estável em retries; sem colisões óbvias.
  - **Prioridade:** P0

### 2.2 Segurança de logs (PII e payload)
- [ ] **T2.2 — Auditoria de logs do WhatsApp para garantir “no payload/no PII”**
  - **Objetivo:** reforçar a regra do runtime: logs apenas com metadados. fileciteturn0file5 fileciteturn0file8
  - **Entregas:**
    - Grep/auditoria por `console.log`, `logger.*(payload|body|message.text|contacts)` etc.
    - Introduzir helpers de mascaramento (ex.: `maskPhone`, `maskEmail`) se algum metadado precisar aparecer.
  - **Critérios de aceite:**
    - Nenhum log imprime payload bruto, headers sensíveis ou tokens.
  - **Prioridade:** P0

### 2.3 Confiabilidade: classificação de erros e retry/backoff (onde houver outbound)
- [ ] **T2.3 — Padronizar classificação de erro “upstream” e “validation”**
  - **Objetivo:** melhorar diagnósticos e evitar retry indevido.
  - **Entregas:**
    - Erros com `errorCode` estável (ex.: `VALIDATION_FAILED`, `SIGNATURE_INVALID`, `UPSTREAM_429`, `UPSTREAM_5XX`, `HANDLER_EXCEPTION`).
    - Testes cobrindo: 400 parse, 401 signature, falha parcial (200 com `failed>0`).
  - **Critérios de aceite:**
    - Logs e responses consistentes com o contrato do runtime. fileciteturn0file5
  - **Prioridade:** P1

### 2.4 Infra/env: sanear variáveis e documentação do app
- [ ] **T2.4 — Documentar e validar env vars do `apps/whatsapp`**
  - **Objetivo:** reduzir erro operacional e drift em Staging/Prod.
  - **Entregas:**
    - `apps/whatsapp/README.md` com:
      - lista de envs obrigatórias/opcionais
      - como validar webhook/signature
      - como rodar testes com fixtures
    - Validação de env via Zod no startup (falhar rápido).
  - **Critérios de aceite:**
    - App sobe com erro claro se faltar env; health reflete readiness.
  - **Prioridade:** P1

---

## 3) Instagram (ainda não validado em Staging: preparar para “Active” com lastro)

### 3.1 Converter para “pipeline igual WhatsApp” (parseEvents + fixtures reais)
- [x] **T3.1 — Implementar/solidificar `packages/core-meta-instagram` para parsing real**
  - **Objetivo:** remover parsing “ad-hoc” no app e criar biblioteca provider-grade com fixtures. fileciteturn0file8
  - **Entregas:**
    - `parseInstagramWebhook(body) -> ParsedEvent[]` (batch-safe).
    - Definição clara de capabilities suportadas (ex.: `inbound_messages` para DMs; `comments`/`leads` se aplicável).
    - dedupeKey determinístico por item.
  - **Critérios de aceite:**
    - Unit tests com fixtures reais sanitizadas passando.
  - **Prioridade:** P0/P1

### 3.2 Fixures reais e testes de batch (pré-Staging)
- [x] **T3.2 — Criar fixtures Instagram reais e testes equivalentes ao WhatsApp**
  - **Objetivo:** preparar validação em Staging sem “tentativa e erro”.
  - **Entregas mínimas (fixtures):**
    - DM inbound texto (1)
    - DM inbound com anexo (1) — se suportado
    - Reação em DM (1) — se suportado
    - “batch misto” com múltiplos itens
  - **Critérios de aceite:**
    - `apps/instagram` processa batch e retorna summary coerente (sem 500 geral).
  - **Prioridade:** P0

### 3.3 Plano de validação em Staging (procedimento operacional)
- [x] **T3.3 — Runbook de validação Staging para Instagram**
  - **Objetivo:** executar testes reais com segurança e rastreabilidade.
  - **Entregas:**
    - Checklist (assinatura, verify token, subscriptions, campos mínimos).
    - Scripts/cURL ou coleção (Postman/HTTPie) para simular fixtures.
    - Observabilidade: como filtrar logs por `correlationId`.
  - **Critérios de aceite:**
    - “Passo a passo” reproduzível por outro dev.
  - **Prioridade:** P1

### 3.4 Status de capabilities: promoção por gate
- [ ] **T3.4 — Marcar capabilities Instagram como `scaffold` até fechar G0/G1/G2**
  - **Objetivo:** coerência com a política do companion. fileciteturn0file8
  - **Entregas:**
    - Manifest ajustado.
    - README e docs alinhados para evitar expectativa incorreta.
  - **Critérios de aceite:**
    - “Active” só após fixtures reais + testes reais + dedupe validado.
  - **Prioridade:** P0

---

## 4) Segurança end-to-end (WhatsApp + Instagram)

### 4.1 Segredos e rotação (dual secret)
- [ ] **T4.1 — Implementar suporte a `secret_current` + `secret_previous` na validação de assinatura**
  - **Objetivo:** permitir rotação sem downtime e reduzir risco operacional. fileciteturn0file8
  - **Entregas:**
    - Validação tenta current e, se falhar, tenta previous.
    - Documentação do procedimento de rotação.
  - **Critérios de aceite:**
    - Webhooks continuam válidos durante a janela de convivência.
  - **Prioridade:** P1

### 4.2 Hardening de entrada: limites, parsing defensivo e timeouts
- [ ] **T4.2 — Definir limites explícitos para payload size e batch size**
  - **Objetivo:** evitar DoS acidental e consumo excessivo.
  - **Entregas:**
    - Limite de tamanho do body (ex.: via middleware).
    - Limite de itens por batch (ex.: recusar >N com 413/400) ou processar com proteção.
  - **Critérios de aceite:**
    - Requests abusivos não derrubam o processo.
  - **Prioridade:** P1

### 4.3 Sanitização e zero-trust para outbound (se/onde existir)
- [ ] **T4.3 — Garantir idempotência em qualquer side-effect (outbound)**
  - **Objetivo:** manter “exactly-once side-effects” com dedupe store. fileciteturn0file8
  - **Entregas:**
    - Definir `clientMessageId` obrigatório no comando outbound.
    - Dedupe outbound separado do inbound (key diferente).
  - **Critérios de aceite:**
    - Retry storm não duplica envio.
  - **Prioridade:** P1/P2

---

## 5) Consistência de DX: documentação, scripts e CI

### 5.1 Documentação “golden path” por app
- [ ] **T5.1 — Criar/atualizar README por app (WhatsApp e Instagram)**
  - **Objetivo:** reduzir dependência de conhecimento tribal. fileciteturn0file6
  - **Entregas por README:**
    - env vars
    - endpoints (`/health`, `/webhook`)
    - como rodar local
    - como rodar testes
    - como validar assinatura
    - exemplos de fixtures
  - **Prioridade:** P2

### 5.2 Scripts consistentes (pnpm filters) e “one-liners”
- [ ] **T5.2 — Padronizar scripts `test:*` e `lint:*` por app/pacote**
  - **Objetivo:** permitir execução rápida e previsível.
  - **Entregas:**
    - `pnpm test:whatsapp`, `pnpm test:instagram`
    - `pnpm lint:whatsapp`, `pnpm lint:instagram`
  - **Prioridade:** P2

### 5.3 CI gate mínimo para merge
- [ ] **T5.3 — Gate de PR: WhatsApp regression + runtime tests obrigatórios**
  - **Objetivo:** impedir regressões silenciosas.
  - **Entregas:**
    - Pipeline executa sempre:
      - `pnpm --filter @connectors/core-runtime test`
      - `pnpm --filter apps/whatsapp test`
    - Para mudanças em Instagram, executar também `apps/instagram test`.
  - **Critérios de aceite:**
    - PR não mergeia sem passar a regressão WhatsApp.
  - **Prioridade:** P0/P1

---

## 6) Limpeza fina (baixo risco, alto retorno)

> Executar após T0.1/T0.2 e depois dos refactors de maior risco.

- [ ] **T6.1 — Remover imports/variáveis não utilizadas e padronizar lint**
  - **Objetivo:** reduzir ruído e risco de manutenção.
  - **Notas:** o repo já possui TODO geral para isso; aqui é “fechamento” com verificação automática. fileciteturn0file7
  - **Prioridade:** P3

- [ ] **T6.2 — Revisar nomenclatura e consistência de pastas de fixtures**
  - **Objetivo:** fixtures previsíveis e fáceis de localizar (WhatsApp e Instagram).
  - **Prioridade:** P3

- [ ] **T6.3 — Revisar e atualizar CHANGELOG quando alterar contrato**
  - **Objetivo:** manter rastreabilidade e SemVer consistente. fileciteturn0file5
  - **Prioridade:** P2

---

## 7) Ordem recomendada de execução (minimizando risco)

1. **T0.1** (regressão WhatsApp)  
2. **T0.2** (auditar status das capabilities)  
3. **T2.1 + T2.2** (blindagem WhatsApp: dedupe + logs)  
4. **T3.1 + T3.2** (Instagram provider package + fixtures/tests)  
5. **T5.3** (CI gate)  
6. **T1.1/T1.2** (refactor estrutural e remoção de legado)  
7. **T4.1/T4.2** (hardening segurança operacional)  
8. **T5.1/T5.2** (docs + scripts)  
9. **T6.x** (limpeza fina)

---

## 8) Definition of Done (DoD) para cada tarefa

Uma tarefa deste TODO só pode ser marcada como concluída quando:
- possui testes (unit e/ou integration) adequados;
- inclui fixtures reais quando envolver parsing/provider;
- não introduz logs com payload/PII;
- respeita batch-safe por padrão (`parseEvents`);
- e (se tocar WhatsApp) passa no gate **T0.1**.
